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
import { detectDocumentRequest, exportDocument } from '../utils/documentExport';
import { generateImageFree, detectImageRequest } from '../services/imageGen';

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
    async (content, attachments = [], webSearch = false, options = {}) => {
      if ((!content.trim() && attachments.length === 0) || isGenerating || !user) return;
      const memoryContext = options.memoryContext || '';

      abortRef.current = false;
      setIsGenerating(true);
      setStreamingContent('');
      setThinkingContent('');

      let convId = currentConversationId;

      const textAttachments = attachments.filter((a) => !a.isImage);
      const imageAttachments = attachments.filter((a) => a.isImage);

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
          attachmentData.push({ name: att.name, type: att.type, isImage: false, parsedText: att.text || '' });
        }
      }

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
          const assistantMsgId = await addMessage(convId, {
            role: 'assistant',
            content: '',
            type: 'image_loading',
          });

          try {
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
          const history = messages.map((m) => {
            let msgContent = m.content;
            if (m.role === 'user' && m.attachments?.length) {
              const fileAttachments = m.attachments.filter(a => !a.isImage && a.parsedText);
              if (fileAttachments.length) {
                const injected = fileAttachments
                  .map((a) => {
                    const ext = a.name.split('.').pop().toLowerCase();
                    const label = ext === 'pdf' ? 'PDF Document' : ['docx','doc'].includes(ext) ? 'Word Document' : 'File';
                    const text = a.parsedText.slice(0, 12000);
                    const truncNote = a.parsedText.length > 12000 ? `\n[...truncated, total: ${a.parsedText.length} chars]` : '';
                    return `=== ${label}: "${a.name}" ===\n${text}${truncNote}\n=== End of "${a.name}" ===`;
                  })
                  .join('\n\n');
                msgContent = `${msgContent}\n\n[Previously attached file(s) — still in context]:\n\n${injected}`;
              }
            }
            return { role: m.role, content: msgContent };
          });

          let userContent = content;

          if (webSearch && content.trim()) {
            try {
              const searchRes = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: content }),
              });
              const searchData = await searchRes.json();
              if (searchData.results?.length) {
                const snippets = searchData.results
                  .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? '\nSource: ' + r.url : ''}`)
                  .join('\n\n');
                userContent = `${content}\n\n===REAL-TIME WEB SEARCH DATA (fetched ${new Date().toUTCString()})===\n${snippets}\n===END SEARCH DATA===\n\nIMPORTANT: The above search results are LIVE data fetched right now from the internet. Your training cutoff does NOT apply here. You MUST base your answer on these search results, not your training data. Cite the sources. Answer:`;
              } else {
                userContent = `${content}\n\n[Web search returned no results. Answer from your knowledge but note your cutoff date.]`;
              }
            } catch (e) {
              console.warn('Web search failed:', e.message);
            }
          }

          if (textAttachments.length > 0) {
            const fileContents = textAttachments
              .map((a) => {
                const ext = a.name.split('.').pop().toLowerCase();
                const label = ext === 'pdf' ? 'PDF Document' : ['docx','doc'].includes(ext) ? 'Word Document' : 'File';
                const text = a.text ? a.text.slice(0, 12000) : '[No text could be extracted from this file]';
                const truncNote = a.text && a.text.length > 12000 ? `\n[...content truncated at 12000 chars, total: ${a.text.length}]` : '';
                return `=== ${label}: "${a.name}" ===\n${text}${truncNote}\n=== End of "${a.name}" ===`;
              })
              .join('\n\n');
            userContent = userContent
              ? `${userContent}\n\n[The following file(s) have been fully parsed and attached. You can read and answer questions about their content]:\n\n${fileContents}`
              : `Please analyze the following file(s):\n\n${fileContents}`;
          }

          if (memoryContext) {
            userContent = `${userContent}${memoryContext}`;
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
            const imgMatch = fullText.match(/\[IMAGE_GEN:\s*([^\]]+)\]/);
            if (imgMatch) {
              const imgPrompt = imgMatch[1].trim();
              await updateMessage(convId, assistantMsgId, { content: '🎨 Generating image...', type: 'text' });
              try {
                const base64 = await generateImageFree(imgPrompt);
                await updateMessage(convId, assistantMsgId, {
                  content: `Here's your generated image:\n\n![Generated Image](${base64})`,
                  type: 'text',
                });
              } catch (imgErr) {
                await updateMessage(convId, assistantMsgId, { content: `Sorry, image generation failed: ${imgErr.message}`, type: 'text' });
              }
            } else {
              const requestedFormat = detectDocumentRequest(content, textAttachments.length > 0);
              if (requestedFormat) {
                try {
                  const filename = `mira-${requestedFormat}-${Date.now()}.${requestedFormat}`;
                  await exportDocument(fullText, requestedFormat, filename);
                  const shortMessage = `✅ Your ${requestedFormat.toUpperCase()} document has been generated and downloaded!\n\n${fullText.split('\n').filter(l => l.startsWith('#')).slice(0, 5).join('\n')}`;
                  await updateMessage(convId, assistantMsgId, { content: shortMessage });
                } catch (exportErr) {
                  await updateMessage(convId, assistantMsgId, { content: `Failed to generate ${requestedFormat.toUpperCase()}: ${exportErr.message}` });
                }
              } else {
                await updateMessage(convId, assistantMsgId, { content: fullText });
              }
            }

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
