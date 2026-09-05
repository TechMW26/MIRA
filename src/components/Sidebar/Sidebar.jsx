import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Plus,
  Search,
  MessageSquare,
  Trash2,
  MoreHorizontal,
  FolderPlus,
  Folder,
  FolderOpen,
  LogOut,
  ChevronDown,
  ChevronRight,
  X,
  Settings,
  FolderInput,
  Lock,
  Unlock,
  ArrowLeft,
  UserPlus,
  Users,
  Bell,
  Check,
  BookOpen,
  FileText,
  Upload,
  Save,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useChatContext } from '../../contexts/ChatContext';
import UserAvatar from '../common/UserAvatar';
import MiraLogo from '../common/MiraLogo';
import useUserProfile from '../../hooks/useUserProfile';
import {
  subscribeConversations,
  getConversation,
  deleteConversation,
  subscribeProjects,
  createProject,
  deleteProject,
  addConversationToProject,
  removeConversationFromProject,
  updateProject,
  inviteProjectMember,
  removeProjectMember,
  subscribeProjectConversations,
  getProjectConversation,
  subscribeProjectInvitations,
  subscribeOutgoingProjectInvitations,
  acceptProjectInvitation,
  declineProjectInvitation,
  cancelProjectInvitation,
  updateProjectInstructions,
  addProjectReferenceDocument,
  removeProjectReferenceDocument,
} from '../../services/database';
import { groupConversationsByDate } from '../../utils/helpers';
import { stopChatGeneration } from '../../services/api';
import { extractFileText, isExtractableFile } from '../../utils/fileParser';
import {
  MISSING_CONVERSATION_GRACE_MS,
  shouldDeferMissingConversationReset,
} from '../../services/chatHydration.js';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const userProfile = useUserProfile();
  const {
    currentConversationId, setCurrentConversationId,
    startNewChat, sidebarOpen, setSidebarOpen, setShowSettings,
    activeProjectId, setActiveProjectId,
    unlockProject, isProjectUnlocked,
    pendingConversationId, confirmConversationRoute,
  } = useChatContext();

  // Auto-hide only after the pointer has remained outside for three seconds.
  // Internal navigation never closes the sidebar; the close button remains explicit.
  const hideTimer = useRef(null);
  const missingConversationTimer = useRef(null);
  const cancelHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);
  const scheduleHide = useCallback(() => {
    if (typeof window !== 'undefined') {
      const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (!supportsHover) return;
    }
    cancelHide();
    hideTimer.current = setTimeout(() => setSidebarOpen(false), 3000);
  }, [cancelHide, setSidebarOpen]);
  useEffect(() => {
    if (sidebarOpen) cancelHide();
    return cancelHide;
  }, [sidebarOpen, cancelHide]);

  const [conversations, setConversations] = useState([]);
  const [conversationsReady, setConversationsReady] = useState(false);
  const [projects, setProjects] = useState([]);
  const [sharedProjectConversations, setSharedProjectConversations] = useState([]);
  const [sharedProjectConversationsReady, setSharedProjectConversationsReady] = useState(false);
  const [search, setSearch] = useState('');
  const [showProjects, setShowProjects] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [activeMenu, setActiveMenu] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [moveToProjectMenu, setMoveToProjectMenu] = useState(null);
  const [dragOverProjectId, setDragOverProjectId] = useState(null);
  const [pinModal, setPinModal] = useState(null); // { projectId, mode: 'set' | 'verify', onSuccess }
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [projectMenu, setProjectMenu] = useState(null);
  const [inviteProject, setInviteProject] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [projectInvitations, setProjectInvitations] = useState([]);
  const [outgoingInvitations, setOutgoingInvitations] = useState([]);
  const [inviteAction, setInviteAction] = useState('');
  const [inviteActionError, setInviteActionError] = useState('');
  const [dismissedInviteId, setDismissedInviteId] = useState('');
  const [knowledgeProject, setKnowledgeProject] = useState(null);
  const [projectInstructions, setProjectInstructions] = useState('');
  const [knowledgeStatus, setKnowledgeStatus] = useState('');
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const projectFileInputRef = useRef(null);
  const sidebarRef = useRef(null);
  const contextMenuRef = useRef(null);
  const [moveMenuLeft, setMoveMenuLeft] = useState(false);

  useEffect(() => {
    if (!user) return;
    setConversationsReady(false);
    const unsub1 = subscribeConversations(user.uid, (next) => {
      setConversations(next);
      setConversationsReady(true);
    });
    const unsub2 = subscribeProjects(user.uid, setProjects);
    const unsub3 = subscribeProjectInvitations(user.uid, setProjectInvitations);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [user]);

  useEffect(() => {
    if (!inviteProject?.id) {
      setOutgoingInvitations([]);
      return undefined;
    }
    return subscribeOutgoingProjectInvitations(inviteProject.id, setOutgoingInvitations);
  }, [inviteProject?.id]);

  useEffect(() => {
    if (dismissedInviteId && !projectInvitations.some((invitation) => invitation.id === dismissedInviteId)) {
      setDismissedInviteId('');
    }
  }, [dismissedInviteId, projectInvitations]);

  useEffect(() => {
    if (!activeProjectId) {
      setSharedProjectConversations([]);
      setSharedProjectConversationsReady(false);
      return undefined;
    }
    setSharedProjectConversationsReady(false);
    return subscribeProjectConversations(activeProjectId, (next) => {
      setSharedProjectConversations(next);
      setSharedProjectConversationsReady(true);
    });
  }, [activeProjectId]);

  useEffect(() => {
    let cancelled = false;
    if (missingConversationTimer.current) {
      clearTimeout(missingConversationTimer.current);
      missingConversationTimer.current = null;
    }
    if (currentConversationId) {
      const exists = conversations.some((conversation) => conversation.id === currentConversationId)
        || sharedProjectConversations.some((conversation) => conversation.id === currentConversationId);
      if (exists) {
        confirmConversationRoute(currentConversationId);
      } else if (!shouldDeferMissingConversationReset({
        conversationId: currentConversationId,
        pendingConversationId,
        conversationsReady: activeProjectId ? sharedProjectConversationsReady : conversationsReady,
        existsInList: exists,
      })) {
        // Subscription lists can be stale after a REST write. Clear a route
        // only after the database authoritatively confirms that it is absent.
        missingConversationTimer.current = setTimeout(async () => {
          try {
            const conversation = activeProjectId
              ? await getProjectConversation(activeProjectId, currentConversationId)
              : await getConversation(user?.uid, currentConversationId);
            if (cancelled) return;
            if (conversation) {
              confirmConversationRoute(currentConversationId);
              return;
            }
            stopChatGeneration();
            setCurrentConversationId(null);
          } catch (error) {
            // Network uncertainty must not destroy a valid in-progress route.
            console.warn('Conversation existence check failed:', error?.message || error);
          } finally {
            missingConversationTimer.current = null;
          }
        }, MISSING_CONVERSATION_GRACE_MS);
      }
    }
    return () => {
      cancelled = true;
      if (missingConversationTimer.current) {
        clearTimeout(missingConversationTimer.current);
        missingConversationTimer.current = null;
      }
    };
  }, [
    activeProjectId,
    confirmConversationRoute,
    conversations,
    conversationsReady,
    currentConversationId,
    pendingConversationId,
    setCurrentConversationId,
    sharedProjectConversations,
    sharedProjectConversationsReady,
    user?.uid,
  ]);

  useEffect(() => {
    if (activeProjectId && projects.length > 0) {
      const exists = projects.some((project) => project.id === activeProjectId);
      if (!exists) {
        setActiveProjectId(null);
      }
    }
  }, [activeProjectId, projects, setActiveProjectId]);

  useEffect(() => {
    if (!inviteProject) return;
    const updated = projects.find((project) => project.id === inviteProject.id);
    if (updated) setInviteProject(updated);
  }, [inviteProject?.id, projects]);

  useEffect(() => {
    if (!knowledgeProject) return;
    const updated = projects.find((project) => project.id === knowledgeProject.id);
    if (updated) setKnowledgeProject(updated);
  }, [knowledgeProject?.id, projects]);

  // Close menus on outside click
  useEffect(() => {
    const handler = () => { setActiveMenu(null); setContextMenu(null); setMoveToProjectMenu(null); setShowUserMenu(false); setProjectMenu(null); };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const filtered = search
    ? conversations.filter((c) => c.title?.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  // Separate: unassigned chats (no projectId) for main list
  const unassignedFiltered = filtered.filter((c) => !c.projectId);
  const grouped = groupConversationsByDate(unassignedFiltered);

  // Get chats belonging to the active project
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const activeProjectMemberCount = Math.max(1, Object.keys(activeProject?.members || {}).length);
  const projectConversations = activeProjectId
    ? [...new Map([
      ...conversations.filter((c) => c.projectId === activeProjectId),
      ...sharedProjectConversations,
    ].map((conversation) => [conversation.id, conversation])).values()]
    : [];
  const projectGrouped = groupConversationsByDate(
    search ? projectConversations.filter((c) => c.title?.toLowerCase().includes(search.toLowerCase())) : projectConversations
  );

  async function handleDelete(convId, e) {
    if (e) e.stopPropagation();
    setActiveMenu(null);
    setContextMenu(null);
    if (user) {
      if (currentConversationId === convId) stopChatGeneration();
      const conv = [...conversations, ...sharedProjectConversations].find((c) => c.id === convId);
      if (conv?.ownerUid && conv.ownerUid !== user.uid && activeProject?.ownerUid !== user.uid) return;
      if (conv?.projectId) {
        await removeConversationFromProject(user.uid, conv.projectId, convId);
      }
      await deleteConversation(conv?.ownerUid || user.uid, convId);
      if (currentConversationId === convId) startNewChat();
    }
  }

  function openInviteModal(project) {
    setProjectMenu(null);
    setInviteProject(project);
    setInviteEmail('');
    setInviteStatus('');
  }

  function openKnowledgeModal(project) {
    setProjectMenu(null);
    setKnowledgeProject(project);
    setProjectInstructions(project.instructions || '');
    setKnowledgeStatus('');
  }

  async function handleSaveProjectInstructions() {
    if (!knowledgeProject || !user) return;
    setKnowledgeLoading(true);
    setKnowledgeStatus('');
    try {
      await updateProjectInstructions(user.uid, knowledgeProject.id, projectInstructions);
      setKnowledgeStatus('Project instructions saved for every chat.');
    } catch (error) {
      setKnowledgeStatus(error?.message || 'Could not save project instructions.');
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function handleProjectFileUpload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!knowledgeProject || !user || !files.length) return;
    setKnowledgeLoading(true);
    setKnowledgeStatus('');
    let uploaded = 0;
    try {
      for (const file of files.slice(0, 8)) {
        if (!isExtractableFile(file)) throw new Error(`${file.name} is not a supported text, PDF, or DOCX file.`);
        const text = await extractFileText(file);
        await addProjectReferenceDocument(user.uid, knowledgeProject.id, {
          name: file.name,
          type: file.type,
          size: file.size,
          text,
        });
        uploaded += 1;
      }
      setKnowledgeStatus(`${uploaded} reference document${uploaded === 1 ? '' : 's'} added to the project.`);
    } catch (error) {
      setKnowledgeStatus(error?.message || 'Could not add that project document.');
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function handleRemoveProjectDocument(documentId) {
    if (!knowledgeProject || !user) return;
    setKnowledgeLoading(true);
    setKnowledgeStatus('');
    try {
      await removeProjectReferenceDocument(user.uid, knowledgeProject.id, documentId);
      setKnowledgeStatus('Reference document removed.');
    } catch (error) {
      setKnowledgeStatus(error?.message || 'Could not remove that document.');
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function handleInvite() {
    if (!inviteProject || !user || !inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteStatus('');
    try {
      const invited = await inviteProjectMember(user.uid, inviteProject.id, inviteEmail);
      setInviteEmail('');
      setInviteStatus(`Invitation sent to ${invited.displayName || invited.email}.`);
    } catch (error) {
      setInviteStatus(error?.message || 'Could not invite that account.');
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleInvitationAction(invitation, action) {
    if (!user || !invitation?.id) return;
    setInviteAction(`${action}:${invitation.id}`);
    setInviteActionError('');
    try {
      if (action === 'accept') {
        await acceptProjectInvitation(user.uid, invitation.id);
      } else {
        await declineProjectInvitation(user.uid, invitation.id);
      }
    } catch (error) {
      setInviteActionError(error?.message || `Could not ${action} this invitation.`);
    } finally {
      setInviteAction('');
    }
  }

  async function handleCancelInvitation(invitation) {
    if (!user || !inviteProject) return;
    setInviteAction(`cancel:${invitation.id}`);
    setInviteStatus('');
    try {
      await cancelProjectInvitation(user.uid, inviteProject.id, invitation.id);
      setInviteStatus('Invitation cancelled.');
    } catch (error) {
      setInviteStatus(error?.message || 'Could not cancel that invitation.');
    } finally {
      setInviteAction('');
    }
  }

  async function handleRemoveMember(memberUid) {
    if (!inviteProject || !user) return;
    try {
      await removeProjectMember(user.uid, inviteProject.id, memberUid);
      setInviteStatus('Collaborator removed.');
    } catch (error) {
      setInviteStatus(error?.message || 'Could not remove that collaborator.');
    }
  }

  async function handleCreateProject() {
    if (!newProjectName.trim() || !user) return;
    await createProject(user.uid, newProjectName.trim());
    setNewProjectName('');
    setShowNewProject(false);
  }

  async function handleMoveToProject(convId, projectId) {
    if (!user) return;
    setContextMenu(null);
    setMoveToProjectMenu(null);
    // Remove from current project if any
    const conv = conversations.find((c) => c.id === convId);
    if (conv?.projectId) {
      await removeConversationFromProject(user.uid, conv.projectId, convId);
    }
    await addConversationToProject(user.uid, projectId, convId);
  }

  function requirePin(project, mode, onSuccess) {
    if (!project.pin) {
      onSuccess();
      return;
    }
    if (isProjectUnlocked(project.id)) {
      onSuccess();
      return;
    }
    setPinModal({ projectId: project.id, mode: mode || 'verify', onSuccess });
    setPinInput('');
    setPinError('');
  }

  function handlePinSubmit() {
    const project = projects.find((p) => p.id === pinModal.projectId);
    if (pinModal.mode === 'set') {
      if (pinInput.length < 4) { setPinError('PIN must be at least 4 digits'); return; }
      updateProject(user.uid, pinModal.projectId, { pin: pinInput });
      unlockProject(pinModal.projectId);
      setPinModal(null);
      setPinInput('');
      return;
    }
    // Verify
    if (pinInput === project?.pin) {
      unlockProject(pinModal.projectId);
      setPinModal(null);
      setPinInput('');
      if (pinModal.onSuccess) pinModal.onSuccess();
    } else {
      setPinError('Incorrect PIN');
    }
  }

  function handleOpenProject(project) {
    requirePin(project, 'verify', () => {
      stopChatGeneration();
      setActiveProjectId(project.id);
      setCurrentConversationId(null);
    });
  }

  async function handleDeleteProject(project) {
    setProjectMenu(null);
    requirePin(project, 'verify', async () => {
      await deleteProject(user.uid, project.id);
      if (activeProjectId === project.id) {
        setActiveProjectId(null);
        startNewChat();
      }
    });
  }

  function handleSetPin(project) {
    setProjectMenu(null);
    setPinModal({ projectId: project.id, mode: 'set', onSuccess: null });
    setPinInput('');
    setPinError('');
  }

  function handleRemovePin(project) {
    setProjectMenu(null);
    requirePin(project, 'verify', () => {
      updateProject(user.uid, project.id, { pin: null });
    });
  }

  // Drag-and-drop handlers for chats
  function handleDragStart(e, convId) {
    e.dataTransfer.setData('text/plain', convId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleProjectDragOver(e, projectId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverProjectId(projectId);
  }

  function handleProjectDragLeave() {
    setDragOverProjectId(null);
  }

  async function handleProjectDrop(e, project) {
    e.preventDefault();
    setDragOverProjectId(null);
    const convId = e.dataTransfer.getData('text/plain');
    if (!convId || !user) return;
    // If project has pin and not unlocked, require pin first
    requirePin(project, 'verify', () => handleMoveToProject(convId, project.id));
  }

  // Right-click context menu for chats
  function handleContextMenu(e, conv) {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 196;
    const menuHeight = conv?.projectId ? 156 : 122;
    const margin = 10;
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : e.clientX + menuWidth;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : e.clientY + menuHeight;
    const x = Math.max(margin, Math.min(e.clientX, viewportW - menuWidth - margin));
    const y = Math.max(margin, Math.min(e.clientY, viewportH - menuHeight - margin));

    setMoveMenuLeft(viewportW < 820 || x > viewportW - 360);
    setContextMenu({ convId: conv.id, x, y, projectId: conv.projectId });
    setMoveToProjectMenu(null);
    setActiveMenu(null);
  }

  // ── Render chat list (reused in main & project views) ──
  function renderChatList(groupedData, showDrag = true) {
    const entries = Object.entries(groupedData);
    if (entries.length === 0) {
      return (
        <div className="px-3 py-10 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
          {search ? 'No chats found' : 'No conversations yet'}
        </div>
      );
    }
    return entries.map(([label, convs]) => (
      <div key={label}>
        <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest sticky top-0 z-10" style={{ color: 'var(--text-tertiary)' }}>
          {label}
        </div>
        <div className="space-y-0.5">
          {convs.map((conv) => {
            const isActive = currentConversationId === conv.id;
            return (
              <div
                key={conv.id}
                onClick={() => {
                  if (currentConversationId !== conv.id) stopChatGeneration();
                  setCurrentConversationId(conv.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, conv)}
                draggable={showDrag}
                onDragStart={(e) => handleDragStart(e, conv.id)}
                className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 relative ${isActive ? 'shadow-sm' : ''}`}
                style={{ background: isActive ? 'var(--accent-glow)' : 'transparent', color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              >
                <MessageSquare size={14} className="flex-shrink-0" style={{ color: isActive ? 'var(--accent)' : 'var(--text-tertiary)' }} />
                <span className="truncate text-sm flex-1">{conv.title || 'New Chat'}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleContextMenu(e, conv); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-lg transition-all"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    ));
  }

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
          style={{ background: 'var(--overlay-bg)' }}
        />
      )}

      <aside
        ref={sidebarRef}
        onMouseEnter={cancelHide}
        onMouseLeave={scheduleHide}
        className={`mira-sidebar ${sidebarOpen ? 'open' : ''} fixed inset-y-0 left-0 z-50 flex flex-col h-full`}
      >
        <div className="mira-sidebar-panel flex flex-col h-full overflow-hidden glass-strong">

          {/* Header */}
          <div className="p-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {activeProjectId ? (
                <button
                  onClick={() => {
                    stopChatGeneration();
                    setActiveProjectId(null);
                    setCurrentConversationId(null);
                  }}
                  className="p-1.5 rounded-xl transition-all hover:scale-105"
                  style={{ color: 'var(--text-secondary)' }}
                  title="Back to all chats"
                >
                  <ArrowLeft size={18} />
                </button>
              ) : (
                <MiraLogo size={36} />
              )}
              <div className="min-w-0 flex-1">
                <span className="block truncate font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  {activeProjectId ? (activeProject?.name || 'Project') : 'MIRA'}
                </span>
                <p className="text-[10px] leading-tight" style={{ color: 'var(--text-tertiary)' }}>
                  {activeProjectId ? `${projectConversations.length} chats` : 'AI Assistant'}
                </p>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-0.5">
              <button
                onClick={() => {
                  startNewChat();
                }}
                className="p-2 rounded-xl transition-all duration-200 hover:scale-105"
                style={{ color: 'var(--text-secondary)' }}
                title="New chat"
              >
                <Plus size={15} />
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-md transition-all duration-200 hover:scale-105"
                style={{ color: 'var(--text-secondary)' }}
                title="Close sidebar"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="px-3 mb-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats..."
                className="w-full glass-input rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none transition-all duration-200 focus:ring-1 focus:ring-[var(--border)] placeholder:text-[var(--text-tertiary)]"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {projectInvitations.length > 0 && (
            <section className="px-3 mb-3" aria-label="Project invitations">
              <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
                <Bell size={11} /> Invitations
                <span className="ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
                  {projectInvitations.length}
                </span>
              </div>
              <div className="space-y-2">
                {projectInvitations.map((invitation) => (
                  <div key={invitation.id} className="rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)' }}>
                    <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{invitation.projectName}</p>
                    <p className="mt-0.5 truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      Invited by {invitation.invitedBy?.displayName || invitation.invitedBy?.email || 'a collaborator'}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleInvitationAction(invitation, 'accept')}
                        disabled={Boolean(inviteAction)}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium disabled:opacity-50"
                        style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
                      >
                        <Check size={12} /> {inviteAction === `accept:${invitation.id}` ? 'Joining…' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInvitationAction(invitation, 'decline')}
                        disabled={Boolean(inviteAction)}
                        className="flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium disabled:opacity-50"
                        style={{ background: 'var(--btn-secondary-bg)', color: 'var(--btn-secondary-text)' }}
                      >
                        {inviteAction === `decline:${invitation.id}` ? 'Declining…' : 'Decline'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {inviteActionError && <p className="px-2 pt-2 text-[10px] text-red-400" role="alert">{inviteActionError}</p>}
            </section>
          )}

          {/* ── PROJECT WORKSPACE VIEW ── */}
          {activeProjectId ? (
            <div className="flex-1 overflow-y-auto px-2 space-y-3 pb-2">
              <div className="mx-1 rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)' }}>
                <div className="min-w-0">
                  <div className="min-w-0 px-1">
                    <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {activeProjectMemberCount} member{activeProjectMemberCount === 1 ? '' : 's'}
                    </p>
                    <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      Shared project workspace
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    {activeProject?.isOwner && (
                      <button
                        type="button"
                        onClick={() => openInviteModal(activeProject)}
                        className="inline-flex w-full items-center justify-start gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition-all hover:opacity-90"
                        style={{ background: 'var(--btn-secondary-bg)', color: 'var(--btn-secondary-text)' }}
                      >
                        <UserPlus size={14} className="flex-shrink-0" /> Invite collaborators
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openKnowledgeModal(activeProject)}
                      className="inline-flex w-full items-center justify-start gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition-all hover:opacity-90"
                      style={{ background: 'var(--btn-secondary-bg)', color: 'var(--btn-secondary-text)' }}
                    >
                      <BookOpen size={14} className="flex-shrink-0" /> Project knowledge
                    </button>
                  </div>
                </div>
              </div>
              {renderChatList(projectGrouped, true)}
            </div>
          ) : (
            <>
              {/* Projects */}
              <div className="px-3 mb-2">
                <button
                  onClick={() => setShowProjects(!showProjects)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest transition"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {showProjects ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  <Folder size={10} />
                  Projects
                </button>
                {showProjects && (
                  <div className="ml-3 mt-1 space-y-0.5 animate-fade-in">
                    {projects.map((p) => (
                      <div
                        key={p.id}
                        onClick={(e) => { e.stopPropagation(); handleOpenProject(p); }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setProjectMenu(projectMenu === p.id ? null : p.id); }}
                        onDragOver={(e) => handleProjectDragOver(e, p.id)}
                        onDragLeave={handleProjectDragLeave}
                        onDrop={(e) => handleProjectDrop(e, p)}
                        className={`group flex items-center gap-2 px-2.5 py-2 text-sm rounded-lg cursor-pointer transition-all relative ${
                          dragOverProjectId === p.id ? 'ring-1' : ''
                        }`}
                        style={{
                          color: 'var(--text-secondary)',
                          background: dragOverProjectId === p.id ? 'var(--accent-glow)' : 'transparent',
                          ...(dragOverProjectId === p.id ? { ringColor: 'var(--accent)' } : {}),
                        }}
                      >
                        {dragOverProjectId === p.id ? <FolderOpen size={13} style={{ color: 'var(--accent)' }} /> : <Folder size={13} />}
                        <span className="truncate flex-1">{p.name}</span>
                        {p.pin && <Lock size={10} style={{ color: 'var(--text-tertiary)' }} />}
                        <button
                          onClick={(e) => { e.stopPropagation(); setProjectMenu(projectMenu === p.id ? null : p.id); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          <MoreHorizontal size={12} />
                        </button>
                        {projectMenu === p.id && (
                          <div className="absolute right-0 top-full mt-1 z-50 glass rounded-xl shadow-2xl py-1 min-w-[160px] animate-fade-in" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => handleOpenProject(p)} className="flex items-center gap-2 w-full px-3 py-2 text-sm transition rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                              <FolderOpen size={13} /> Open
                            </button>
                            <button onClick={() => openKnowledgeModal(p)} className="flex items-center gap-2 w-full px-3 py-2 text-sm transition rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                              <BookOpen size={13} /> Project knowledge
                            </button>
                            {p.isOwner && <button onClick={() => openInviteModal(p)} className="flex items-center gap-2 w-full px-3 py-2 text-sm transition rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                              <UserPlus size={13} /> Invite people
                            </button>}
                            {p.isOwner && (p.pin ? (
                              <button onClick={() => handleRemovePin(p)} className="flex items-center gap-2 w-full px-3 py-2 text-sm transition rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                                <Unlock size={13} /> Remove PIN
                              </button>
                            ) : (
                              <button onClick={() => handleSetPin(p)} className="flex items-center gap-2 w-full px-3 py-2 text-sm transition rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                                <Lock size={13} /> Set PIN
                              </button>
                            ))}
                            {p.isOwner && <button onClick={() => handleDeleteProject(p)} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition rounded-lg">
                              <Trash2 size={13} /> Delete
                            </button>}
                          </div>
                        )}
                      </div>
                    ))}
                    {showNewProject ? (
                      <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                          placeholder="Project name"
                          autoFocus
                          className="flex-1 glass-input rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--border)]"
                          style={{ color: 'var(--text-primary)' }}
                        />
                        <button onClick={handleCreateProject} className="p-1 rounded transition-all hover:scale-110" style={{ color: 'var(--accent)' }}><Plus size={14} /></button>
                      </div>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setShowNewProject(true); }} className="flex items-center gap-2 px-2.5 py-1.5 text-xs transition" style={{ color: 'var(--text-tertiary)' }}>
                        <FolderPlus size={11} /> New project
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="mx-4 mb-2" style={{ borderTop: '1px solid var(--border)' }} />

              {/* Conversations (unassigned) */}
              <div className="flex-1 overflow-y-auto px-2 space-y-3 pb-2">
                {renderChatList(grouped, true)}
              </div>
            </>
          )}

          {/* User */}
          <div className="p-3 relative" style={{ borderTop: '1px solid var(--border)' }}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowUserMenu(!showUserMenu); }}
              className="flex items-center gap-3 w-full px-2 py-2 rounded-xl transition-all duration-200"
            >
              <UserAvatar profile={userProfile} size={36} />
              <div className="flex-1 text-left min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{userProfile.displayName || 'User'}</div>
                <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{userProfile.email}</div>
              </div>
            </button>
            {showUserMenu && (
              <div className="absolute bottom-full left-3 right-3 mb-2 glass rounded-xl shadow-2xl py-1 z-50 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    setShowSettings(true);
                  }}
                  className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm transition-all rounded-lg"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <Settings size={14} /> Settings
                </button>
                <button
                  onClick={() => {
                    stopChatGeneration();
                    setShowUserMenu(false);
                    logout();
                  }}
                  className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm transition-all rounded-lg"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {projectInvitations[0] && projectInvitations[0].id !== dismissedInviteId && (
        <aside
          className="fixed bottom-5 right-5 z-[220] w-[min(24rem,calc(100vw-2rem))] glass-strong rounded-2xl p-4 shadow-2xl animate-fade-in"
          style={{ border: '1px solid var(--border)' }}
          aria-live="polite"
          aria-label="New project invitation"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
              <UserPlus size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Project invitation</p>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {projectInvitations[0].invitedBy?.displayName || projectInvitations[0].invitedBy?.email || 'A collaborator'} invited you to <strong>{projectInvitations[0].projectName}</strong>.
              </p>
            </div>
            <button type="button" onClick={() => setDismissedInviteId(projectInvitations[0].id)} className="rounded-lg p-1.5" aria-label="Dismiss invitation popup" style={{ color: 'var(--text-tertiary)' }}>
              <X size={15} />
            </button>
          </div>
          <div className="mt-4 flex gap-2 pl-[3.25rem]">
            <button
              type="button"
              onClick={() => handleInvitationAction(projectInvitations[0], 'decline')}
              disabled={Boolean(inviteAction)}
              className="flex-1 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50"
              style={{ background: 'var(--btn-secondary-bg)', color: 'var(--btn-secondary-text)' }}
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => handleInvitationAction(projectInvitations[0], 'accept')}
              disabled={Boolean(inviteAction)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              <Check size={13} /> Accept
            </button>
          </div>
          {inviteActionError && <p className="mt-2 pl-[3.25rem] text-[10px] text-red-400" role="alert">{inviteActionError}</p>}
        </aside>
      )}

      {/* ── RIGHT-CLICK CONTEXT MENU ── */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[100] glass rounded-xl shadow-2xl py-1 min-w-[180px] animate-fade-in"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Move to project */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMoveToProjectMenu(moveToProjectMenu ? null : contextMenu.convId); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm transition rounded-lg"
              style={{ color: 'var(--text-secondary)' }}
            >
              <FolderInput size={13} /> Move to project
              <ChevronRight size={12} className="ml-auto" />
            </button>
            {moveToProjectMenu && (
              <div
                className="absolute top-0 glass rounded-xl shadow-2xl py-1 min-w-[160px] animate-fade-in"
                style={moveMenuLeft ? { right: 'calc(100% + 6px)' } : { left: 'calc(100% + 6px)' }}
              >
                {projects.length === 0 ? (
                  <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>No projects yet</div>
                ) : (
                  projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        requirePin(p, 'verify', () => handleMoveToProject(contextMenu.convId, p.id));
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm transition rounded-lg"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Folder size={13} /> {p.name}
                      {p.pin && <Lock size={9} className="ml-auto" style={{ color: 'var(--text-tertiary)' }} />}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {/* Remove from project (if in one) */}
          {contextMenu.projectId && (
            <button
              onClick={async () => {
                if (user) await removeConversationFromProject(user.uid, contextMenu.projectId, contextMenu.convId);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm transition rounded-lg"
              style={{ color: 'var(--text-secondary)' }}
            >
              <X size={13} /> Remove from project
            </button>
          )}
          <button
            onClick={() => handleDelete(contextMenu.convId)}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition rounded-lg"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}

      {/* ── PIN MODAL ── */}
      {pinModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in" style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(4px)' }} onClick={() => setPinModal(null)}>
          <div className="glass-strong rounded-2xl p-6 w-full max-w-xs shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-glow)' }}>
                <Lock size={18} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {pinModal.mode === 'set' ? 'Set Project PIN' : 'Enter PIN'}
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {pinModal.mode === 'set' ? 'Choose a PIN (min 4 digits)' : 'This project is protected'}
                </p>
              </div>
            </div>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handlePinSubmit()}
              placeholder="Enter PIN..."
              autoFocus
              maxLength={8}
              className="w-full glass-input rounded-xl px-4 py-3 text-sm text-center tracking-[0.5em] outline-none focus:ring-1 focus:ring-[var(--border)] mb-2"
              style={{ color: 'var(--text-primary)' }}
            />
            {pinError && <p className="text-xs text-red-400 text-center mb-2">{pinError}</p>}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setPinModal(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={{ background: 'var(--btn-secondary-bg)', color: 'var(--btn-secondary-text)' }}
              >
                Cancel
              </button>
              <button
                onClick={handlePinSubmit}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90"
                style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
              >
                {pinModal.mode === 'set' ? 'Set PIN' : 'Unlock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {inviteProject && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 animate-fade-in" style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(4px)' }} onClick={() => setInviteProject(null)}>
          <div className="glass-strong rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-glow)' }}>
                  <Users size={18} style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Project collaborators</h3>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{inviteProject.name}</p>
                </div>
              </div>
              <button type="button" onClick={() => setInviteProject(null)} className="p-1.5 rounded-lg" aria-label="Close collaborator dialog" style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>
            </div>

            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => { setInviteEmail(event.target.value); setInviteStatus(''); }}
                onKeyDown={(event) => event.key === 'Enter' && handleInvite()}
                placeholder="Existing account email"
                className="flex-1 glass-input rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-[var(--border)]"
                style={{ color: 'var(--text-primary)' }}
                autoFocus
              />
              <button type="button" onClick={handleInvite} disabled={inviteLoading || !inviteEmail.trim()} className="px-4 rounded-xl text-sm font-medium disabled:opacity-50" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}>
                {inviteLoading ? 'Adding…' : 'Invite'}
              </button>
            </div>
            {inviteStatus && <p className="mt-2 text-xs" role="status" style={{ color: 'var(--text-secondary)' }}>{inviteStatus}</p>}

            <div className="mt-5 space-y-2 max-h-56 overflow-y-auto">
              {Object.values(inviteProject.members || {}).map((member) => (
                <div key={member.uid} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)' }}>
                  <UserAvatar profile={member} size={30} rounded="rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{member.displayName || member.email}</p>
                    <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{member.role === 'owner' ? 'Owner' : member.email}</p>
                  </div>
                  {member.role !== 'owner' && (
                    <button type="button" onClick={() => handleRemoveMember(member.uid)} className="p-1.5 rounded-lg text-red-400" aria-label={`Remove ${member.displayName || member.email}`} title="Remove collaborator"><X size={14} /></button>
                  )}
                </div>
              ))}
              {outgoingInvitations.map((invitation) => (
                <div key={`pending-${invitation.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)' }}>
                  <UserAvatar profile={invitation.invitee} size={30} rounded="rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" style={{ color: 'var(--text-primary)' }}>{invitation.invitee?.displayName || invitation.invitee?.email}</p>
                    <p className="truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Invitation pending</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancelInvitation(invitation)}
                    disabled={Boolean(inviteAction)}
                    className="rounded-lg p-1.5 text-red-400 disabled:opacity-50"
                    aria-label={`Cancel invitation for ${invitation.invitee?.displayName || invitation.invitee?.email}`}
                    title="Cancel invitation"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {knowledgeProject && (
        <div className="fixed inset-0 z-[215] flex items-center justify-center p-4 animate-fade-in" style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(4px)' }} onClick={() => setKnowledgeProject(null)}>
          <div className="glass-strong rounded-2xl p-6 w-full max-w-xl max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-glow)' }}>
                  <BookOpen size={18} style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Project knowledge</h3>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{knowledgeProject.name}</p>
                </div>
              </div>
              <button type="button" onClick={() => setKnowledgeProject(null)} className="p-1.5 rounded-lg" aria-label="Close project knowledge dialog" style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>
            </div>

            <label htmlFor="project-instructions" className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Project instructions</label>
            <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>Applied to every conversation in this folder alongside its shared chat and document context.</p>
            <textarea
              id="project-instructions"
              value={projectInstructions}
              onChange={(event) => setProjectInstructions(event.target.value)}
              disabled={!knowledgeProject.isOwner}
              placeholder="Describe the project, preferred terminology, audience, output style, and standing rules…"
              rows={6}
              maxLength={12000}
              className="mt-3 w-full resize-y glass-input rounded-xl px-3 py-3 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-[var(--border)] disabled:opacity-70"
              style={{ color: 'var(--text-primary)' }}
            />
            {knowledgeProject.isOwner ? (
              <div className="mt-2 flex justify-end">
                <button type="button" onClick={handleSaveProjectInstructions} disabled={knowledgeLoading} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium disabled:opacity-50" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}>
                  <Save size={13} /> Save instructions
                </button>
              </div>
            ) : (
              <p className="mt-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Only the project owner can edit shared instructions.</p>
            )}

            <div className="my-5" style={{ borderTop: '1px solid var(--border)' }} />
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Reference documents</h4>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>PDF, DOCX, and text-based files become shared project context.</p>
              </div>
              <input ref={projectFileInputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.java,.html,.css,.sql" onChange={handleProjectFileUpload} />
              <button type="button" onClick={() => projectFileInputRef.current?.click()} disabled={knowledgeLoading} className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50" style={{ background: 'var(--btn-secondary-bg)', color: 'var(--btn-secondary-text)' }}>
                <Upload size={13} /> Upload
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {Object.values(knowledgeProject.referenceDocuments || {}).map((document) => (
                <div key={document.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--border)' }}>
                  <FileText size={16} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{document.name}</p>
                    <p className="truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Added by {document.uploadedBy?.displayName || document.uploadedBy?.email || 'a collaborator'}</p>
                  </div>
                  {(knowledgeProject.isOwner || document.uploadedBy?.uid === user?.uid) && (
                    <button type="button" onClick={() => handleRemoveProjectDocument(document.id)} disabled={knowledgeLoading} className="rounded-lg p-1.5 text-red-400 disabled:opacity-50" aria-label={`Remove ${document.name}`} title="Remove document"><Trash2 size={14} /></button>
                  )}
                </div>
              ))}
              {Object.keys(knowledgeProject.referenceDocuments || {}).length === 0 && (
                <div className="rounded-xl px-4 py-6 text-center text-xs" style={{ background: 'var(--glass-bg)', border: '1px dashed var(--border)', color: 'var(--text-tertiary)' }}>No project reference documents yet.</div>
              )}
            </div>
            {knowledgeStatus && <p className="mt-3 text-xs" role="status" style={{ color: 'var(--text-secondary)' }}>{knowledgeStatus}</p>}
          </div>
        </div>
      )}
    </>
  );
}
