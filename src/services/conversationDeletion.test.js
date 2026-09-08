import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationDeletionUpdates, evictDeletedConversation} from './conversationDeletion.js';

test('standalone deletion targets only the selected chat and its messages',()=>{
  assert.deepEqual(conversationDeletionUpdates('owner','chat'),{'conversations/owner/chat':null,'messages/chat':null});
});
test('shared project deletion atomically removes all chat references using the correct owners',()=>{
  const updates=conversationDeletionUpdates('chat-owner','chat',{projectId:'project',projectOwnerUid:'project-owner'});
  assert.equal(Object.keys(updates).length,6);
  assert.ok(Object.hasOwn(updates,'projects/project-owner/project/conversations/chat'));
  assert.ok(Object.hasOwn(updates,'conversations/chat-owner/chat'));
  assert.ok(Object.hasOwn(updates,'projectChats/project/chat'));
  assert.ok(Object.values(updates).every(value=>value===null));
});
test('invalid targets cannot broaden deletion scope',()=>{
  for(const id of ['', 'a/b', 'a.b', null])assert.throws(()=>conversationDeletionUpdates('owner',id));
});
test('cache eviction survives reload without removing other chats',()=>{
  const data=new Map([['mira-conversations-owner',JSON.stringify([{id:'chat'},{id:'keep'}])],['mira-messages-chat','[]'],['mira-messages-keep','[]']]);
  const storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  evictDeletedConversation(storage,'owner','chat');
  assert.deepEqual(JSON.parse(data.get('mira-conversations-owner')),[{id:'keep'}]);
  assert.equal(data.has('mira-messages-chat'),false);
  assert.equal(data.has('mira-messages-keep'),true);
});
