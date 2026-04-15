import { useState, useRef, useEffect, useCallback } from 'react';
import { sendChatMessage, generateImage } from '../services/api';
import {
  createConversation,
  addMessage,
  updateMessage,
  updateConversation,
  subscribeMessages,
} from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { useChatContext } from '../contexts/ChatContext';
import { generateTitle, detectIntent } from '../utils/helpers';

export default function useChat() {
  const { user } = useAuth();
  const {
    currentConversationId,
    setCurrentConversationId,
    isGenerating,
    setIsGenerating,
    model,
  } = useChatContext();

  const [messages, setMessages] = useState([]);
  const [streamingContent, setStreamingContent] = useState('');
  const abortRef = useRef(false);

  // Subscribe to messages when conversation changes
  useEffect(() => {
    if (!currentConversationId) {
      setMessages([]);
      return;
    }

    const unsub = subscribeMessages(currentConversationId, (msgs) => {
      setMessages(msgs);
    });
    return unsub;
  }, [currentConversationId]);

  const stopGenerating = useCallback(() => {
    abortRef.current = true;
    setIsGenerating(false);
    setStreamingContent('');
  }, [setIsGenerating]);

  const sendMessage = useCallback(
    async (content) => {
      if (!content.trim() || isGenerating || !user) return;

      abortRef.current = false;
      setIsGenerating(true);
      setStreamingContent('');

      let convId = currentConversationId;

      try {
        // Create conversation if needed
        if (!convId) {
          const conv = await createConversation(user.uid, 'New Chat');
          convId = conv.id;
          setCurrentConversationId(convId);
        }

        // Add user message
        await addMessage(convId, { role: 'user', content, type: 'text' });

        const intent = detectIntent(content);

        if (intent === 'image') {
          // Image generation
          const assistantMsgId = await addMessage(convId, {
            role: 'assistant',
            content: 'Generating image...',
            type: 'text',
          });

          try {
            const result = await generateImage(content);
            let imageContent;
            if (result.url) {
              imageContent = `![Generated Image](${result.url})\n\n${result.revised_prompt ? `*${result.revised_prompt}*` : ''}`;
            } else if (result.base64) {
              imageContent = `![Generated Image](data:${result.mimeType};base64,${result.base64})`;
            }
            await updateMessage(convId, assistantMsgId, {
              content: imageContent,
              type: 'image',
            });
          } catch (err) {
            await updateMessage(convId, assistantMsgId, {
              content: `Sorry, I couldn't generate that image: ${err.message}`,
              type: 'text',
            });
          }
        } else {
          // Chat completion with streaming
          const history = messages.map((m) => ({
            role: m.role,
            content: m.content,
          }));
          history.push({ role: 'user', content });

          const assistantMsgId = await addMessage(convId, {
            role: 'assistant',
            content: '',
            type: 'text',
          });

          let fullText = '';
          try {
            await sendChatMessage(history, model, (accumulated) => {
              if (abortRef.current) return;
              fullText = accumulated;
              setStreamingContent(accumulated);
            });
          } catch (err) {
            fullText = fullText || `Sorry, something went wrong: ${err.message}`;
          }

          if (fullText) {
            await updateMessage(convId, assistantMsgId, { content: fullText });
          }
        }

        // Auto-title on first message
        if (messages.length === 0) {
          const title = generateTitle(content);
          await updateConversation(user.uid, convId, { title });
        }
      } catch (err) {
        console.error('Send message error:', err);
      } finally {
        setIsGenerating(false);
        setStreamingContent('');
      }
    },
    [currentConversationId, isGenerating, messages, model, user, setCurrentConversationId, setIsGenerating]
  );

  return {
    messages,
    streamingContent,
    sendMessage,
    stopGenerating,
    isGenerating,
  };
}
