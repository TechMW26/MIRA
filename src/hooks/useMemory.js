import { useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUserMemories, addUserMemory, deleteUserMemory } from '../services/database';

// Auto-extract memorable facts from conversation
function extractMemories(userMsg, assistantMsg) {
  const facts = [];
  const text = userMsg + ' ' + assistantMsg;

  const patterns = [
    { re: /my name is ([A-Z][a-z]+ ?[A-Z]?[a-z]*)/i, prefix: 'User name is' },
    { re: /i(?:'m| am) (?:a |an )?([a-z]+ ?(?:developer|engineer|designer|student|teacher|doctor|manager|founder|ceo|cto|researcher)[a-z]*)/i, prefix: 'User is a' },
    { re: /i (?:work|working) (?:at|for|with) ([A-Z][A-Za-z0-9 ]+)/i, prefix: 'User works at' },
    { re: /i(?:'m| am) (?:from|based in|living in) ([A-Z][A-Za-z ]+)/i, prefix: 'User is from' },
    { re: /i (?:prefer|use|love|like) ([a-z]+(?:script|python|java|rust|go|ruby|php|swift|kotlin|typescript|react|vue|angular|node)[a-z]*)/i, prefix: 'User prefers' },
    { re: /my (?:company|startup|project|app|product) (?:is |called )?([A-Z][A-Za-z0-9 ]+)/i, prefix: 'User\'s project is' },
  ];

  for (const { re, prefix } of patterns) {
    const m = text.match(re);
    if (m?.[1]) facts.push(`${prefix}: ${m[1].trim()}`);
  }
  return facts;
}

export default function useMemory() {
  const { user } = useAuth();
  const memoriesRef = useRef([]);

  useEffect(() => {
    if (!user) return;
    getUserMemories(user.uid).then(mems => {
      memoriesRef.current = mems;
    });
  }, [user]);

  const getMemoryContext = useCallback(() => {
    if (!memoriesRef.current.length) return '';
    const facts = memoriesRef.current.map(m => `- ${m.content}`).join('\n');
    return `\n\n[MEMORY — facts you know about this user]:\n${facts}\nUse these naturally in conversation when relevant.`;
  }, []);

  const processAndSave = useCallback(async (userMsg, assistantMsg) => {
    if (!user) return;
    const facts = extractMemories(userMsg, assistantMsg);
    for (const fact of facts) {
      // Don't duplicate
      const exists = memoriesRef.current.some(m => m.content.toLowerCase() === fact.toLowerCase());
      if (!exists) {
        const id = await addUserMemory(user.uid, fact);
        memoriesRef.current.push({ id, content: fact, createdAt: Date.now() });
      }
    }
  }, [user]);

  const addMemory = useCallback(async (content) => {
    if (!user || !content.trim()) return;
    const id = await addUserMemory(user.uid, content.trim());
    memoriesRef.current.push({ id, content: content.trim(), createdAt: Date.now() });
  }, [user]);

  const removeMemory = useCallback(async (id) => {
    if (!user) return;
    await deleteUserMemory(user.uid, id);
    memoriesRef.current = memoriesRef.current.filter(m => m.id !== id);
  }, [user]);

  const getMemories = useCallback(() => memoriesRef.current, []);

  return { getMemoryContext, processAndSave, addMemory, removeMemory, getMemories };
}
