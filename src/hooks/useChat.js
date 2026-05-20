import { useState, useRef, useEffect, useCallback } from 'react';
import { sendChatMessage, SYSTEM_PROMPT } from '../services/api';
import { analyzeImage } from '../services/imageAnalysis.js';
import { processQuery } from '../services/engine';
import {
  createConversation,
  addMessage,
  updateMessage,
  deleteMessage,
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
const MEDIA_REQUEST_PATTERN = /\b(video|videos|clip|clips|media|reel|reels|youtube|instagram|social\s+posts?)\b|\b(show|find|fetch|get|search|check|look\s+up|more)\b[^.!?]{0,40}\b(images|photos|pictures)\b|\b(images|photos|pictures)\b[^.!?]{0,40}\b(show|find|fetch|get|search|check|look\s+up|more)\b/i;
const VISUAL_WEB_REQUEST_PATTERN = /\b(who|what|which|identify|recognize|verify|match|search|check|look\s+up|find\s+out)\b[^.!?]{0,80}\b(image|photo|picture|person|device|product|object|this)\b|\b(image|photo|picture|person|device|product|object|this)\b[^.!?]{0,80}\b(who|what|which|identify|recognize|verify|match|search|check|look\s+up|find\s+out)\b/i;
const CONTEXTUAL_DEVICE_MEDIA_PATTERN = /\b(this|that|the)\s+(device|product|tool|item|object|thing|model|prototype|machine|system)\b|\b(tell me more|more about|details about|background on|explain)\b[^.!?]{0,70}\b(this|that|it|device|product|object|thing|model|prototype|machine|system)\b/i;

function isMediaRequest(text = '') {
  return MEDIA_REQUEST_PATTERN.test(String(text || ''));
}

function isMediaOnlyRequest(text = '') {
  const value = String(text || '').trim();
  if (!isMediaRequest(value)) return false;
  const asksForSubstantiveAnswer = /\b(who|what|why|how|explain|tell\s+me\s+more|details?|overview|summary|analy[sz]e|compare|review|price|cost|specs?|features?|benefits?|identify|verify|latest|current|news|research|information|info)\b/i.test(value);
  const asksForMediaAction = /\b(show|find|fetch|get|search|check|look\s+up|pull|give)\b[^.!?]{0,70}\b(videos?|clips?|media|images?|photos?|pictures?|reels?|youtube|instagram)\b|\b(more|related|relevant)?\s*(videos?|clips?|media|images?|photos?|pictures?|reels?)\b/i.test(value);
  return asksForMediaAction && !asksForSubstantiveAnswer;
}

function needsVisualSearchAnchor(text = '', hasImages = false) {
  return hasImages && VISUAL_WEB_REQUEST_PATTERN.test(String(text || ''));
}

function wantsContextualDeviceMedia(text = '') {
  return CONTEXTUAL_DEVICE_MEDIA_PATTERN.test(String(text || ''));
}

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

function isExportRefusal(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return false;

  return (
    /(?:^|[\s\n])(i\s+(?:cannot|can't|won't|am unable|'?m unable)|sorry[,\s]+(?:i\s+)?(?:cannot|can't|won't|am unable))/i.test(normalized)
    && /\b(pdf|docx|pptx|downloadable|file|document)\b/i.test(normalized)
  ) || (
    /\b(cannot provide|can't provide|unable to provide|won't provide)\b/i.test(normalized)
    && /\b(pdf|docx|pptx|downloadable|file|document)\b/i.test(normalized)
  );
}

function getFallbackExportContent(history = []) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== 'assistant') continue;

    const cleaned = sanitizeDocumentContent(message.content || '');
    if (cleaned && cleaned.length > 80 && !isExportRefusal(cleaned)) {
      return cleaned;
    }
  }

  return '';
}

function cloneAttachmentsForResend(message) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  return attachments.map((attachment) => ({ ...attachment }));
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          return part.text || part.content || part.value || '';
        }
        return '';
      })
      .join('');
  }
  if (typeof content === 'object') {
    return content.text || content.content || content.value || JSON.stringify(content);
  }
  return String(content);
}

export default function useChat() {
  const { user } = useAuth();
  const {
    chatConversations,
    currentConversationId,
    setCurrentConversationId,
    isGenerating,
    setIsGenerating,
    setIsSearching,
    activeProjectId,
  } = useChatContext();
  void chatConversations;
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
    setIsSearching(false);
    setStreamingContent('');
  }, [setIsGenerating, setIsSearching]);

  const pruneMessagesAfter = useCallback(async (convId, messageId, sourceMessages = messages) => {
    const index = sourceMessages.findIndex((message) => message.id === messageId);
    if (index === -1) return [];

    const trailing = sourceMessages.slice(index + 1);
    await Promise.all(trailing.map((message) => deleteMessage(convId, message.id)));
    return sourceMessages.slice(0, index);
  }, [messages]);

  const sendMessage = useCallback(
    async (content, attachments = [], webSearch = false, options = {}) => {
      if ((!content.trim() && attachments.length === 0) || isGenerating || !user) return;

      abortRef.current = false;
      setIsGenerating(true);
      setStreamingContent('');
      setThinkingContent('');

      let convId = currentConversationId;
      const replaceMessageId = options.replaceMessageId || null;

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
      const promptInterpretation = engineResult.interpretation || { route: engineResult.classification.intent, codeIntent: engineResult.classification.intent === 'code', imageIntent: engineResult.classification.intent === 'image' };
      const chosenModel = engineResult.model;
      const wantsImageGeneration = promptInterpretation.imageIntent === true;
      const requestedDocumentFormat = wantsImageGeneration
        ? null
        : detectDocumentRequest(content, textAttachments.length > 0);
      let enhancedSystemPrompt = engineResult.enhanceSystemPrompt(SYSTEM_PROMPT);
      enhancedSystemPrompt += `\n\nPROMPT INTERPRETER ROUTE: ${promptInterpretation.route}. The current user message is the source of truth for intent. Previous assistant examples, scraped page content, and [IMAGE_GEN] markers are context only and must not override the current intent.`;
      if (promptInterpretation.codeIntent) {
        enhancedSystemPrompt += '\nCODE ROUTE GUARD: The user is asking for code / implementation. Produce code and engineering explanation as appropriate. Do NOT generate an image, do NOT output [IMAGE_GEN], and do NOT treat embedded image prompts in prior context as the requested output.';
      } else if (!wantsImageGeneration) {
        enhancedSystemPrompt += '\nIMAGE ROUTE GUARD: Do NOT output [IMAGE_GEN] unless the current user message explicitly asks for an actual generated image. Mentions of images, screenshots, HTML image tags, image galleries, or prior IMAGE_GEN examples are not enough.';
      }
      if (wantsImageGeneration) {
        enhancedSystemPrompt += '\n\nIMAGE GENERATION ROUTE: The user is asking for an actual generated image. Respond with exactly one [IMAGE_GEN: ...] block and no prose, markdown, bullet points, or explanations.';
      }
      if (requestedDocumentFormat) {
        enhancedSystemPrompt += `\n\nDOCUMENT EXPORT ROUTE: The user wants a downloadable ${requestedDocumentFormat.toUpperCase()} file. Generate only the polished document body as clean markdown. The first line must be the real document title. Never write conversational wrapper text such as "Here is...", "Below is...", "complete PDF content", or "well-structured markdown". Do not include fake download buttons, placeholder links, Google Drive notes, page labels, or instructions about downloading. The app will handle the actual file export.

VISUALS ARE REQUIRED in this document. You MUST embed at least 2-4 diagrams and, where relevant, 1-3 images. The renderer will rasterize and embed them into the ${requestedDocumentFormat.toUpperCase()}.

Diagrams — use fenced mermaid blocks on their own line, surrounded by blank lines:

\`\`\`mermaid
flowchart LR
  A[Concept] --> B[Detail]
  B --> C{Decision}
  C -->|Yes| D[Outcome]
  C -->|No| E[Alternative]
\`\`\`

Supported mermaid types: flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, pie, mindmap, timeline, journey, quadrantChart. Pick the type that best fits the concept (architectures → flowchart; processes → flowchart or sequenceDiagram; data models → erDiagram or classDiagram; timelines → timeline or gantt; hierarchies → mindmap; comparisons → quadrantChart).

Mermaid syntax rules (STRICT — invalid syntax means the diagram is dropped):
- ALWAYS start with the diagram type keyword on its own line (e.g. \`flowchart LR\`, \`sequenceDiagram\`, \`mindmap\`).
- Use plain ASCII node labels inside [brackets] or (parens). Avoid HTML, &lt;br&gt;, emojis, backticks, or quotes inside labels.
- For \`gantt\` you MUST include \`dateFormat YYYY-MM-DD\` and \`title ...\` and use \`section\` headers; otherwise use a \`timeline\` instead.
- For \`mindmap\` use indentation (2 spaces per level), no arrows.
- Keep each diagram under ~25 nodes — split very large diagrams across multiple blocks.

Images — only include when you have a known, directly-linked, publicly accessible image URL ending in .jpg/.jpeg/.png/.webp/.svg. Strongly prefer:
- Wikimedia Commons direct upload URLs: https://upload.wikimedia.org/wikipedia/commons/...
- Wikipedia thumbnail URLs: https://upload.wikimedia.org/wikipedia/en/thumb/...

Write each image on its own line:

![Concise descriptive caption](https://upload.wikimedia.org/wikipedia/commons/x/yz/Example.jpg)

Never invent image URLs, never link to Google search/redirect URLs, never link to HTML pages, never use example.com / placeholder.com. If you do not know a real direct image URL for a concept, OMIT the image and use a mermaid diagram instead. Do not include a "Images" section header with a list of broken images — that looks unprofessional.

Place every image and every mermaid block on its own line with a blank line above and below so it renders as a standalone figure.`;
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

        let historySource = isNewChat ? [] : messages;
        if (replaceMessageId) {
          historySource = await pruneMessagesAfter(convId, replaceMessageId, historySource);
        }

        const history = historySource.map((m) => {
          let msgContent = normalizeMessageContent(m.promptContent || m.content);
          if (promptInterpretation.codeIntent && m.role === 'assistant' && IMAGE_GEN_PATTERN.test(msgContent)) {
            msgContent = '[Previous assistant response generated an image prompt. Current task is code; do not continue image generation.]';
          }
          if (m.role === 'user' && m.attachments?.length) {
            const fileAttachments = m.attachments.filter(a => !a.isImage && (a.parsedText || a.parseError));
            if (fileAttachments.length) {
              const injected = buildAttachmentPrompt(fileAttachments, HISTORY_ATTACHMENT_CHAR_LIMIT);
              msgContent = `${msgContent}\n\n[Previously attached file(s) — still in context]:\n\n${injected}`;
            }
          }
          return { role: m.role, content: msgContent };
        });

        if (replaceMessageId) {
          await updateMessage(convId, replaceMessageId, {
            content: displayContent,
            type: 'text',
            ...(options.promptContent ? { promptContent: options.promptContent } : { promptContent: null }),
            ...(options.webPage ? { webPage: options.webPage } : { webPage: null }),
            ...(attachmentData.length > 0 ? { attachments: attachmentData } : { attachments: null }),
          });
        } else {
          await addMessage(convId, {
            role: 'user',
            content: displayContent,
            type: 'text',
            ...(options.promptContent ? { promptContent: options.promptContent } : {}),
            ...(options.webPage ? { webPage: options.webPage } : {}),
            ...(attachmentData.length > 0 ? { attachments: attachmentData } : {}),
          });
        }

        const assistantMsgId = await addMessage(convId, {
          role: 'assistant',
          content: '',
          type: 'text',
        });

        // Media (videos + images) fetched alongside the web search.
        // Attached to the assistant message for the UI gallery — NOT injected
        // into the LLM prompt (would bloat tokens and confuse the model).
        let mediaForMessage = null;
        let deterministicMediaReply = null;

        {
          let userContent = options.promptContent || content;

          // Auto-enable web search when the engine detects the query needs
          // real-time / external info, even if the user didn't toggle it.
          const effectiveWebSearch = webSearch || engineResult.needsSearch;
          const wantsMediaGallery = isMediaRequest(content);
          const wantsOnlyMediaGallery = isMediaOnlyRequest(content);
          const shouldUseVisualAnchor = needsVisualSearchAnchor(content, hasImages);
          const shouldAttachContextualMedia = wantsContextualDeviceMedia(content);
          let visualSearchAnchor = '';

          // Build a context-aware search query. Short follow-up questions like
          // "tell me more about this device" lose meaning without prior context,
          // so we anchor the query with proper-noun entities extracted from the
          // most recent assistant reply. Keep the query SHORT — search engines
          // (especially news RSS) return no results for long noisy queries.
          const buildContextualSearchQuery = (current) => {
            if (visualSearchAnchor) {
              const STOP_VISUAL = new Set(['who','what','which','image','photo','picture','person','device','product','object','this','that','check','search','look','find','web','internet','online','please','about','more','tell']);
              const intentWords = current.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
                .filter((w) => w.length > 2 && !STOP_VISUAL.has(w))
                .slice(0, 3);
              return [visualSearchAnchor, ...intentWords].join(' ').replace(/\s+/g, ' ').trim();
            }

            const PRONOUN_RE = /\b(it|its|this|that|these|those|they|them|the (device|product|tool|item|object|thing|company|person|model|app|software|platform|service))\b/i;
            const looksReferential = current.length < 80 || PRONOUN_RE.test(current);
            if (!looksReferential || historySource.length === 0) return current;

            const recent = historySource.slice(-4);
            const lastAssistant = [...recent].reverse().find((m) => m.role === 'assistant');
            const lastUser = [...recent].reverse().find((m) => m.role === 'user' && m.content !== current);

            // Extract proper-noun-ish tokens (Capitalized, ALLCAPS, or quoted)
            // from the assistant turn, then the previous user turn as fallback.
            const extractEntities = (text) => {
              if (!text) return [];
              const matches = String(text).slice(0, 2000).match(/"([^"]{2,40})"|\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\b|\b([A-Z]{2,}(?:\s+[A-Z]{2,})*)\b/g) || [];
              const STOP = new Set(['I', 'The', 'A', 'An', 'It', 'This', 'That', 'You', 'He', 'She', 'We', 'They', 'My', 'Your']);
              return Array.from(new Set(
                matches
                  .map((s) => s.replace(/"/g, '').trim())
                  .filter((s) => s.length > 2 && !STOP.has(s))
              ));
            };

            const entities = [
              ...extractEntities(lastAssistant?.content),
              ...extractEntities(lastUser?.content),
            ];
            const dedup = Array.from(new Set(entities)).slice(0, 3);
            if (!dedup.length) return current;

            // Pull a couple of meaningful keywords from the current message
            // (skip stopwords and the pronouns we used to detect referentiality).
            const STOP_KW = new Set(['can','you','tell','me','more','about','this','that','the','a','an','is','are','was','were','do','does','did','what','how','why','when','where','please','it','its','they','them','these','those','of','to','for','on','in','with','and','or','but']);
            const kw = current.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
              .filter((w) => w.length > 2 && !STOP_KW.has(w))
              .slice(0, 2);

            // Final query: entities first (they carry the topic), then a couple
            // of keywords from the current question. Short and search-friendly.
            return [...dedup, ...kw].join(' ').trim() || current;
          };

          // Web search injection — skip when an explicit document export is requested,
          // so unrelated search results don't override the attached/previous file context.
          if (effectiveWebSearch && content.trim() && !requestedDocumentFormat) {
            setIsSearching(true);
            try {
              if (shouldUseVisualAnchor && imageAttachments[0]) {
                try {
                  const visual = await analyzeImage(
                    'Return concise web-search keywords for this image. Include visible text, logos, product names, person identity clues, place/event clues, and distinctive objects. Do not guess a person identity unless there is visible text or a highly recognizable public figure. Output one short search query only.',
                    imageAttachments[0],
                    imageAttachments[0].mimeType || imageAttachments[0].type || 'image/jpeg',
                  );
                  visualSearchAnchor = String(visual?.result || '').replace(/[\n\r]+/g, ' ').replace(/^search query:\s*/i, '').trim().slice(0, 180);
                } catch (visualErr) {
                  console.warn('Visual search anchor failed:', visualErr.message);
                }
              }
              const searchQuery = buildContextualSearchQuery(content);
              const shouldAttachRelatedMedia = wantsMediaGallery || shouldUseVisualAnchor || shouldAttachContextualMedia;
              const includeMedia = shouldAttachRelatedMedia;
              const searchRes = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: searchQuery, includeMedia }),
              });
              const searchData = await searchRes.json();
              const realVideos = Array.isArray(searchData.media?.videos) ? searchData.media.videos : [];
              const realImages = Array.isArray(searchData.media?.images) ? searchData.media.images : [];
              const mediaBlock = (() => {
                if (!shouldAttachRelatedMedia || (!realVideos.length && !realImages.length)) return '';
                const lines = [];
                if (realVideos.length) {
                  lines.push('Videos (auto-rendered as embeds below your reply):');
                  realVideos.slice(0, 6).forEach((v, i) => {
                    const platform = v.platform || 'web';
                    const title = (v.title || '').replace(/\s+/g, ' ').trim() || `${platform} video`;
                    lines.push(`  v${i + 1}. [${platform}] ${title} — ${v.url || v.embed || ''}`);
                  });
                }
                if (realImages.length) {
                  if (lines.length) lines.push('');
                  lines.push('Images (auto-rendered as thumbnails below your reply):');
                  realImages.slice(0, 6).forEach((im, i) => {
                    const title = (im.title || '').replace(/\s+/g, ' ').trim() || 'image';
                    lines.push(`  i${i + 1}. ${title} — ${im.url || ''}`);
                  });
                }
                return `\n\n=== REAL MEDIA GALLERY (already shown to the user as embeds/thumbnails under your reply) ===\n${lines.join('\n')}\n=== END MEDIA GALLERY ===`;
              })();
              if (wantsMediaGallery) {
                if (realVideos.length || realImages.length) {
                  mediaForMessage = { videos: realVideos, images: realImages, query: searchQuery };
                  if (wantsOnlyMediaGallery) {
                    deterministicMediaReply = 'Here are the most relevant clips and photos I found — open any item in the gallery below to play or preview it here.';
                  }
                } else if (wantsOnlyMediaGallery) {
                  deterministicMediaReply = "I couldn't find relevant embeddable media for this search this time.";
                }
              }
              if (!wantsMediaGallery && shouldUseVisualAnchor && (realVideos.length || realImages.length)) {
                mediaForMessage = { videos: realVideos, images: realImages, query: searchQuery };
              }
              if (searchData.results?.length) {
                const snippets = searchData.results
                  .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? '\nSource: ' + r.url : ''}`)
                  .join('\n\n');
                userContent = `${content}\n\n=== REAL-TIME WEB SEARCH DATA (fetched ${new Date().toUTCString()}) ===\nSearch query used: "${searchQuery}"\n\n${snippets}\n=== END SEARCH DATA ===${mediaBlock}\n\nUSAGE RULES:\n- These results are LIVE data fetched right now from the internet — your training cutoff does NOT apply here.\n- However, conversation context comes FIRST. If the user is using pronouns ("this", "that", "it", "the device", etc.), resolve them from the prior turns before interpreting these search results.\n- If the search results clearly do not match the entity the user is referring to in this conversation, IGNORE the search results and answer from prior turns / your own knowledge instead. Do NOT pivot to an unrelated topic just because it appeared in the search results.\n- When the results are on-topic, cite the sources by their [number].\n- MEDIA RULES (strict, NON-NEGOTIABLE):\n   • NEVER write or paste any YouTube, Instagram, Twitter/X, TikTok, or article URL as text or as a markdown link in your reply. The user has already had real links/embeds rendered for them by the UI (see the MEDIA GALLERY block above and the [number] citations).\n   • NEVER invent video titles, image descriptions, durations, channel names, view counts, or URLs. If you do not have a verified value, omit it.\n   • The UI auto-renders an embedded video player + image gallery directly under your reply for every item in the MEDIA GALLERY block. Do NOT enumerate them.\n   • When the user asks for "videos", "images", "more media", "social posts", or similar, reply with ONE short sentence pointing at the gallery (e.g. "Here are the most relevant clips and photos I found — see the gallery below.") and stop.\n   • If the MEDIA GALLERY block is empty, say plainly that you couldn't find relevant media this time. Do NOT invent placeholder links to fill the gap.\n\nAnswer:`;
                if (!wantsOnlyMediaGallery && shouldAttachRelatedMedia) {
                  userContent = userContent.replace(
                    '   • When the user asks for "videos", "images", "more media", "social posts", or similar, reply with ONE short sentence pointing at the gallery (e.g. "Here are the most relevant clips and photos I found — see the gallery below.") and stop.',
                    '   • If the user asks a substantive question (details, explanation, identity, research, comparison, features, latest info, etc.), answer that question first using the web results and citations. Treat the media gallery as complementary supporting material, not the whole answer. Only media-only requests should get a one-sentence gallery pointer.'
                  );
                  userContent += '\n\nADDITIONAL MEDIA GUIDANCE: Answer the user\'s actual question with researched details and citations first. If related media is available, treat it only as a complementary gallery below the answer; do not replace the answer with a media-only sentence.';
                }
              } else {
                userContent = `${content}\n\n[Web search returned no results.${mediaBlock ? ' A related media gallery is rendered below; reference it briefly without inventing links.' : ' Answer from conversation context and your knowledge; note your cutoff date if relevant.'}]${mediaBlock}`;
              }
              if (visualSearchAnchor) {
                userContent = userContent
                  .replace(`Search query used: "${searchQuery}"`, `Search query used: "${searchQuery}"\nImage-derived search anchor: "${visualSearchAnchor}"`)
                  .replace('- When the results are on-topic, cite the sources by their [number].', '- For image identity / object matching, only identify a person, product, place, or device when the source title/snippet clearly matches visible text, logo, distinctive object details, or the image-derived anchor. If the match is weak, say you could not verify it from the web results.\n- When the results are on-topic, cite the sources by their [number].');
              }
              if (realVideos.length || realImages.length) {
                if (shouldAttachRelatedMedia) mediaForMessage = { videos: realVideos, images: realImages, query: searchQuery };
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

          if (deterministicMediaReply) {
            await updateMessage(convId, assistantMsgId, {
              content: deterministicMediaReply,
              ...(mediaForMessage ? { media: mediaForMessage } : {}),
            });
            if (isNewChat) {
              generateSmartTitle(content, deterministicMediaReply).then((title) => {
                updateConversation(user.uid, convId, { title });
              });
            }
            return;
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
                if (accumulated) setIsSearching(false);
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
              const sanitizedContent = sanitizeDocumentContent(fullText);
              const fallbackContent = getFallbackExportContent(historySource);
              const documentContent = isExportRefusal(sanitizedContent)
                ? fallbackContent || sanitizedContent
                : sanitizedContent;
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
              await updateMessage(convId, assistantMsgId, {
                content: fullText,
                ...(mediaForMessage ? { media: mediaForMessage } : {}),
              });
            }

            if (isNewChat) {
              const titleSource = requestedFormat
                ? (isExportRefusal(sanitizedContent) ? (fallbackContent || sanitizedContent) : sanitizedContent)
                : fullText;
              generateSmartTitle(content, titleSource).then((title) => {
                updateConversation(user.uid, convId, { title });
              });
            }
          }
        }
      } catch (err) {
        console.error('Send message error:', err);
      } finally {
        setIsGenerating(false);
        setIsSearching(false);
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
      setIsSearching,
      activeProjectId,
      normalizeImageForUpload,
      pruneMessagesAfter,
    ]
  );

  const retryMessage = useCallback(async (message, webSearch = false) => {
    if (!message?.id || message.role !== 'user') return;
    stopGenerating();
    await sendMessage(message.content || '', cloneAttachmentsForResend(message), webSearch, {
      replaceMessageId: message.id,
      ...(message.promptContent ? { promptContent: message.promptContent } : {}),
      ...(message.webPage ? { webPage: message.webPage } : {}),
    });
  }, [sendMessage, stopGenerating]);

  const editMessage = useCallback(async (message, nextContent, webSearch = false) => {
    if (!message?.id || message.role !== 'user') return;
    const content = String(nextContent || '').trim();
    if (!content) return;

    stopGenerating();
    await sendMessage(content, cloneAttachmentsForResend(message), webSearch, {
      replaceMessageId: message.id,
    });
  }, [sendMessage, stopGenerating]);

  return {
    messages,
    streamingContent,
    thinkingContent,
    sendMessage,
    stopGenerating,
    isGenerating,
    retryMessage,
    editMessage,
  };
}
