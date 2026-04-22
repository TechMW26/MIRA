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
import { generateSmartTitle } from '../utils/helpers';

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

  const normalizeImageForUpload = useCallback(async (image) => {
    const raw = image.base64 || '';
    const sourceDataUrl = raw.startsWith('data:')
      ? raw
      : `data:${image.mimeType || image.type || 'image/jpeg'};base64,${raw}`;

    // If image is already small, keep original bytes.
    const initialBase64 = sourceDataUrl.split(',')[1] || '';
    if (initialBase64.length < 550_000) {
      return {
        base64: initialBase64,
        mimeType: image.mimeType || image.type || 'image/jpeg',
      };
    }

    const loaded = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = sourceDataUrl;
    });

    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(loaded.width, loaded.height));
    const targetW = Math.max(1, Math.round(loaded.width * scale));
    const targetH = Math.max(1, Math.round(loaded.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        base64: initialBase64,
        mimeType: image.mimeType || image.type || 'image/jpeg',
      };
    }

    ctx.drawImage(loaded, 0, 0, targetW, targetH);
    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);

    return {
      base64: compressedDataUrl.split(',')[1] || initialBase64,
      mimeType: 'image/jpeg',
    };
  }, []);

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
        let isNewChat = false;
        if (!convId) {
          isNewChat = true;
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
          // Image analysis with animated placeholder
          const assistantMsgId = await addMessage(convId, {
            role: 'assistant',
            content: '',
            type: 'image_loading',
          });

          try {
            // Pass attached images so Gemini can use them as reference
            const refImages = [];
            for (const img of imageAttachments) {
              refImages.push(await normalizeImageForUpload(img));
            }
            const result = await generateImage(content, refImages);
            const analysisText = result?.result || 'No analysis result was returned.';

            await updateMessage(convId, assistantMsgId, {
              content: analysisText,
              type: 'text',
            });

            // Generate smart title for image analysis chats
            if (isNewChat) {
              generateSmartTitle(content, analysisText).then((title) => {
                updateConversation(user.uid, convId, { title });
              });
            }
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

          const images = [];
          for (const img of imageAttachments) {
            images.push(await normalizeImageForUpload(img));
          }

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

            // Generate smart AI title after first exchange
            if (isNewChat) {
              generateSmartTitle(content, fullText).then((title) => {
                updateConversation(user.uid, convId, { title });
              });
            }
          }
        }
      } catch (err) {
        console.error('Send message error:', err);
      } finally {
        setIsGenerating(false);
        setStreamingContent('');
        setThinkingContent('');
      }
    },
    [
      currentConversationId,
      isGenerating,
      messages,
      user,
      setCurrentConversationId,
      setIsGenerating,
      activeProjectId,
      normalizeImageForUpload,
    ]
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
