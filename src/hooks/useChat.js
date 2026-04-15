import { useState, useRef, useEffect, useCallback } from 'react';
import { sendChatMessage, generateImage, SYSTEM_PROMPT } from '../services/api';
import { processQuery } from '../services/engine';
import {
  createConversation,
  addMessage,
  updateMessage,
  updateConversation,
  addConversationToProject,
  subscribeMessages,
} from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { useChatContext } from '../contexts/ChatContext';
import { generateTitle } from '../utils/helpers';

export default function useChat() {
  const { user } = useAuth();
  const {
    currentConversationId,
    setCurrentConversationId,
    isGenerating,
    setIsGenerating,
    activeProjectId,
  } = useChatContext();

  const [messages, setMessages] = useState([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
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
    async (content, attachments = []) => {
      if ((!content.trim() && attachments.length === 0) || isGenerating || !user) return;

      abortRef.current = false;
      setIsGenerating(true);
      setStreamingContent('');
      setThinkingContent('');

      let convId = currentConversationId;

      // Separate attachment types
      const textAttachments = attachments.filter((a) => !a.isImage);
      const imageAttachments = attachments.filter((a) => a.isImage);

      // Build display content with inline images for user message
      let displayContent = content;
      const attachmentData = [];

      if (imageAttachments.length > 0) {
        for (const img of imageAttachments) {
          attachmentData.push({ name: img.name, type: img.type, isImage: true, base64: img.base64 });
        }
      }

      if (textAttachments.length > 0) {
        const fileList = textAttachments.map((a) => a.name).join(', ');
        displayContent = displayContent
          ? `${displayContent}\n\n[Attached: ${fileList}]`
          : `[Attached: ${fileList}]`;
        for (const att of textAttachments) {
          attachmentData.push({ name: att.name, type: att.type, isImage: false });
        }
      }

      // Run MIRA Engine — classify, pick model, enhance prompt
      const hasImages = imageAttachments.length > 0;
      const engineResult = processQuery(content, hasImages);
      const chosenModel = engineResult.model;
      const enhancedSystemPrompt = engineResult.enhanceSystemPrompt(SYSTEM_PROMPT);

      try {
        if (!convId) {
          const conv = await createConversation(user.uid, 'New Chat');
          convId = conv.id;
          setCurrentConversationId(convId);
          // If user is inside a project workspace, assign new chat to that project
          if (activeProjectId) {
            await addConversationToProject(user.uid, activeProjectId, convId);
          }
        }

        await addMessage(convId, {
          role: 'user',
          content: displayContent,
          type: 'text',
          ...(attachmentData.length > 0 ? { attachments: attachmentData } : {}),
        });

        if (chosenModel === '__image__') {
          // Image generation with animated placeholder
          const assistantMsgId = await addMessage(convId, {
            role: 'assistant',
            content: '',
            type: 'image_loading',
          });

          try {
            const result = await generateImage(content);
            let imageContent = '';

            if (result.url) {
              // Vercel Blob permanent URL
              imageContent = `![Generated Image](${result.url})${result.revised_prompt ? `\n\n*${result.revised_prompt}*` : ''}`;
            } else if (result.base64) {
              // Direct base64 from Gemini (local dev)
              imageContent = `![Generated Image](data:${result.mimeType || 'image/png'};base64,${result.base64})`;
            }

            if (!imageContent) {
              throw new Error('No image was returned');
            }

            await updateMessage(convId, assistantMsgId, {
              content: imageContent,
              type: 'image',
              imageUrl: result.url || null,
            });
          } catch (err) {
            await updateMessage(convId, assistantMsgId, {
              content: `Sorry, I couldn't generate that image: ${err.message}`,
              type: 'text',
            });
          }
        } else {
          // Chat with streaming — engine-selected model & enhanced prompt
          const history = messages.map((m) => ({
            role: m.role,
            content: m.content,
          }));

          let userContent = content;
          if (textAttachments.length > 0) {
            const fileContents = textAttachments
              .map((a) => `--- File: ${a.name} ---\n${a.text}\n--- End of ${a.name} ---`)
              .join('\n\n');
            userContent = userContent
              ? `${userContent}\n\nAttached files:\n${fileContents}`
              : `Please analyze these files:\n${fileContents}`;
          }

          history.push({ role: 'user', content: userContent });

          const images = imageAttachments.map((a) => ({
            base64: a.base64.split(',')[1],
            mimeType: a.mimeType,
          }));

          const assistantMsgId = await addMessage(convId, {
            role: 'assistant',
            content: '',
            type: 'text',
          });

          let fullText = '';
          try {
            await sendChatMessage(
              history,
              chosenModel,
              (accumulated) => {
                if (abortRef.current) return;
                fullText = accumulated;
                setStreamingContent(accumulated);
              },
              images,
              enhancedSystemPrompt,
              {
                onThinking: (accumulated) => {
                  if (abortRef.current) return;
                  setThinkingContent(accumulated);
                },
              },
            );
          } catch (err) {
            fullText = fullText || `Sorry, something went wrong: ${err.message}`;
          }

          if (fullText) {
            await updateMessage(convId, assistantMsgId, { content: fullText });
          }
        }

        if (messages.length === 0) {
          const title = generateTitle(content);
          await updateConversation(user.uid, convId, { title });
        }
      } catch (err) {
        console.error('Send message error:', err);
      } finally {
        setIsGenerating(false);
        setStreamingContent('');
        setThinkingContent('');
      }
    },
    [currentConversationId, isGenerating, messages, user, setCurrentConversationId, setIsGenerating, activeProjectId]
  );

  return {
    messages,
    streamingContent,
    thinkingContent,
    sendMessage,
    stopGenerating,
    isGenerating,
  };
}
