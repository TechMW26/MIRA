import { useState, useRef, useEffect, useCallback } from 'react';
import { sendChatMessage, SYSTEM_PROMPT } from '../services/api';
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
import { detectDocumentRequest, exportDocument, sanitizeDocumentContent } from '../utils/documentExport';

const CURRENT_ATTACHMENT_CHAR_LIMIT = 60000;
const HISTORY_ATTACHMENT_CHAR_LIMIT = 16000;
const IMAGE_GEN_PATTERN = /\[IMAGE_GEN:\s*([\s\S]*?)\]/i;

function cleanImagePrompt(text = '') {
  return String(text || '')
    .replace(/\[IMAGE_GEN:\s*/gi, '')
    .replace(/\]$/g, '')
    .replace(/^(sure|okay|absolutely|here'?s|here is|i can|i will)[\s,:-]+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeImageGenerationOutput(modelText, userText) {
  const markerPrompt = modelText?.match(IMAGE_GEN_PATTERN)?.[1]?.trim();
  const prompt = cleanImagePrompt(markerPrompt || modelText || userText);
  const fallback = cleanImagePrompt(userText) || 'A high-quality, detailed image based on the user request';
  return `[IMAGE_GEN: ${prompt || fallback}]`;
}

function getFileExtension(name = '') {
  return name.split('.').pop().toLowerCase();
}

function getDocumentLabel(name = '') {
  const ext = getFileExtension(name);
  if (ext === 'pdf') return 'PDF Document';
  if (ext === 'docx' || ext === 'doc') return 'Word Document';
  return 'File';
}

function cleanAttachmentText(text = '') {
  return String(text || '').replace(/\u0000/g, '').trim();
}

function formatAttachmentForPrompt(attachment, charLimit) {
  const label = getDocumentLabel(attachment.name);
  const fullText = cleanAttachmentText(attachment.text || attachment.parsedText || '');
  const body = fullText
    ? fullText.slice(0, charLimit)
    : `[No text could be extracted from this file${attachment.parseError ? `: ${attachment.parseError}` : ''}]`;
  const truncNote = fullText.length > charLimit
    ? `\n[...content truncated at ${charLimit} chars, total: ${fullText.length}]`
    : '';
  return `=== ${label}: "${attachment.name}" ===\n${body}${truncNote}\n=== End of "${attachment.name}" ===`;
}

function buildAttachmentPrompt(attachments, charLimit) {
  return attachments.map((attachment) => formatAttachmentForPrompt(attachment, charLimit)).join('\n\n');
}

export default function useChat() {
  const { user } = useAuth();
  const {chatConversations, 
    currentConversationId,
    setCurrentConversationId,
    isGenerating,
    setIsGenerating,
    activeProjectId,
  } = useChatContext()
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
    async (content, attachments = [], webSearch = false) => {
      if ((!content.trim() && attachments.length === 0) || isGenerating || !user) return;

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
          attachmentData.push({ name: att.name, type: att.type, isImage: false, parsedText: att.text || '', parseError: att.parseError || '' });
        }
      }

      const hasImages = imageAttachments.length > 0;
      const engineResult = processQuery(content, hasImages);
      const chosenModel = engineResult.model;
      const wantsImageGeneration = engineResult.classification.intent === 'image';
      const requestedDocumentFormat = wantsImageGeneration
        ? null
        : detectDocumentRequest(content, textAttachments.length > 0);
      let enhancedSystemPrompt = engineResult.enhanceSystemPrompt(SYSTEM_PROMPT);
      if (wantsImageGeneration) {
        enhancedSystemPrompt += '\n\nIMAGE GENERATION ROUTE: The user is asking for an actual generated image. Respond with exactly one [IMAGE_GEN: ...] block and no prose, markdown, bullet points, or explanations.';
      }
      if (requestedDocumentFormat) {
        enhancedSystemPrompt += `\n\nDOCUMENT EXPORT ROUTE: The user wants a downloadable ${requestedDocumentFormat.toUpperCase()} file. Generate only the polished document body as clean markdown. The first line must be the real document title. Never write conversational wrapper text such as "Here is...", "Below is...", "complete PDF content", or "well-structured markdown". Do not include fake download buttons, placeholder links, Google Drive notes, page labels, image placeholder labels, or instructions about downloading. The app will handle the actual file export.`;
      }

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

        const assistantMsgId = await addMessage(convId, {
          role: 'assistant',
          content: '',
          type: 'text',
        });

        {
          // Re-inject parsed file text from previous messages so context is never lost.
          const historySource = isNewChat ? [] : messages;
          const history = historySource.map((m) => {
            let msgContent = m.content;
            if (m.role === 'user' && m.attachments?.length) {
              const fileAttachments = m.attachments.filter(a => !a.isImage && (a.parsedText || a.parseError));
              if (fileAttachments.length) {
                const injected = buildAttachmentPrompt(fileAttachments, HISTORY_ATTACHMENT_CHAR_LIMIT);
                msgContent = `${msgContent}\n\n[Previously attached file(s) — still in context]:\n\n${injected}`;
              }
            }
            return { role: m.role, content: msgContent };
          });

          let userContent = content;

          // Web search injection — skip when an explicit document export is requested,
          // so unrelated search results don't override the attached/previous file context.
          if (webSearch && content.trim() && !requestedDocumentFormat) {
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
                userContent = `${content}\n\n=== REAL-TIME WEB SEARCH DATA (fetched ${new Date().toUTCString()}) ===\n${snippets}\n=== END SEARCH DATA ===\n\nIMPORTANT: The above search results are LIVE data fetched right now from the internet. Your training cutoff does NOT apply here. You MUST base your answer on these search results, not your training data. Cite the sources. Answer:`;
              } else {
                userContent = `${content}\n\n[Web search returned no results. Answer from your knowledge but note your cutoff date.]`;
              }
            } catch (e) {
              console.warn('Web search failed:', e.message);
            }
          }

          if (textAttachments.length > 0) {
            const fileContents = buildAttachmentPrompt(textAttachments, CURRENT_ATTACHMENT_CHAR_LIMIT);
            userContent = userContent
              ? `${userContent}\n\nIMPORTANT: The uploaded file content is included below as plain text. Read it and answer the user's request directly from this content. If the user asks to analyze, summarize, or break down the document, do that now.\n\n${fileContents}`
              : `Please analyze the following file(s):\n\n${fileContents}`;
          }

          if (requestedDocumentFormat) {
            const priorFileNames = historySource
              .flatMap((m) => (m.role === 'user' && Array.isArray(m.attachments)) ? m.attachments : [])
              .filter((a) => a && !a.isImage && (a.parsedText || a.parseError))
              .map((a) => a.name)
              .filter(Boolean);
            const currentFileNames = textAttachments.map((a) => a.name).filter(Boolean);
            const sourceFiles = [...new Set([...currentFileNames, ...priorFileNames])];
            const sourceHint = sourceFiles.length
              ? ` The document must be built strictly from the uploaded file(s) already in this conversation: ${sourceFiles.join(', ')}. Do not introduce unrelated topics, web search snippets, or invented references.`
              : '';
            userContent = `${userContent}\n\nDOCUMENT EXPORT REQUEST: Create the complete ${requestedDocumentFormat.toUpperCase()} document content now.${sourceHint} Return only the final document body in markdown. Start with the actual document title only. Do not add any conversational intro, fake download button, fake URL, placeholder link, page marker, image placeholder, download instruction, or note about markdown. Ignore any unrelated prior search results.`;
          }

          if (wantsImageGeneration) {
            userContent = `${userContent}\n\nIMAGE GENERATION REQUEST: Create a concise but highly detailed visual prompt for this request. Respond only as [IMAGE_GEN: subject, environment, composition, camera, lighting, style, mood, colors, quality].`;
          }
          history.push({ role: 'user', content: userContent });

          const images = [];
          for (const img of imageAttachments) {
            images.push(await normalizeImageForUpload(img));
          }

          let fullText = '';
          let requestFailed = false;
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
            requestFailed = true;
            fullText = fullText || `Sorry, something went wrong: ${err.message}`;
          }

          if (wantsImageGeneration && !requestFailed) {
            fullText = normalizeImageGenerationOutput(fullText, content);
          }

          if (fullText) {
            const requestedFormat = requestedDocumentFormat;
            if (requestedFormat) {
              const documentContent = sanitizeDocumentContent(fullText);
              const documentUpdate = {
                content: documentContent,
                exportFormat: requestedFormat,
                exportStatus: 'ready',
              };
              try {
                const filename = `mira-${requestedFormat}-${Date.now()}.${requestedFormat}`;
                await exportDocument(documentContent, requestedFormat, filename);
              } catch (exportErr) {
                documentUpdate.exportStatus = 'failed';
                documentUpdate.exportError = exportErr?.message || 'Export failed';
              }
              await updateMessage(convId, assistantMsgId, documentUpdate);
            } else {
              await updateMessage(convId, assistantMsgId, { content: fullText });
            }

            if (isNewChat) {
              generateSmartTitle(content, requestedFormat ? sanitizeDocumentContent(fullText) : fullText).then((title) => {
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
