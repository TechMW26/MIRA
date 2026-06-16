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
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useChatContext } from '../../contexts/ChatContext';
import UserAvatar from '../common/UserAvatar';
import useUserProfile from '../../hooks/useUserProfile';
import {
  subscribeConversations,
  deleteConversation,
  subscribeProjects,
  createProject,
  deleteProject,
  addConversationToProject,
  removeConversationFromProject,
  updateProject,
} from '../../services/database';
import { groupConversationsByDate } from '../../utils/helpers';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const userProfile = useUserProfile();
  const {
    currentConversationId, setCurrentConversationId,
    startNewChat, sidebarOpen, setSidebarOpen, setShowSettings,
    activeProjectId, setActiveProjectId,
    unlockProject, isProjectUnlocked,
  } = useChatContext();

  // Auto-hide: once the sidebar is open, close it after 2s of the pointer not
  // hovering over it. Entering the sidebar cancels the countdown.
  const hideTimer = useRef(null);
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
    hideTimer.current = setTimeout(() => setSidebarOpen(false), 2000);
  }, [cancelHide, setSidebarOpen]);
  useEffect(() => {
    if (sidebarOpen) scheduleHide();
    return cancelHide;
  }, [sidebarOpen, scheduleHide, cancelHide]);

  const [conversations, setConversations] = useState([]);
  const [projects, setProjects] = useState([]);
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
  const sidebarRef = useRef(null);
  const contextMenuRef = useRef(null);
  const [moveMenuLeft, setMoveMenuLeft] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsub1 = subscribeConversations(user.uid, setConversations);
    const unsub2 = subscribeProjects(user.uid, setProjects);
    return () => { unsub1(); unsub2(); };
  }, [user]);

  useEffect(() => {
    if (currentConversationId && conversations.length > 0) {
      const exists = conversations.some((conversation) => conversation.id === currentConversationId);
      if (!exists) {
        setCurrentConversationId(null);
      }
    }
  }, [currentConversationId, conversations, setCurrentConversationId]);

  useEffect(() => {
    if (activeProjectId && projects.length > 0) {
      const exists = projects.some((project) => project.id === activeProjectId);
      if (!exists) {
        setActiveProjectId(null);
      }
    }
  }, [activeProjectId, projects, setActiveProjectId]);

  // Close menus on outside click
  useEffect(() => {
    const handler = () => { setActiveMenu(null); setContextMenu(null); setMoveToProjectMenu(null); setShowUserMenu(false); setProjectMenu(null); };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // Close sidebar on outside click/tap (desktop + mobile).
  useEffect(() => {
    if (!sidebarOpen) return undefined;

    const handleOutsidePointer = (event) => {
      const sidebarEl = sidebarRef.current;
      const contextMenuEl = contextMenuRef.current;
      const target = event.target;
      if (!sidebarEl || !(target instanceof Node)) return;
      if (sidebarEl.contains(target)) return;
      if (contextMenuEl && contextMenuEl.contains(target)) return;
      setSidebarOpen(false);
    };

    window.addEventListener('pointerdown', handleOutsidePointer, true);
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointer, true);
    };
  }, [sidebarOpen, setSidebarOpen]);

  const filtered = search
    ? conversations.filter((c) => c.title?.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  // Separate: unassigned chats (no projectId) for main list
  const unassignedFiltered = filtered.filter((c) => !c.projectId);
  const grouped = groupConversationsByDate(unassignedFiltered);

  // Get chats belonging to the active project
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const projectConversations = activeProjectId
    ? conversations.filter((c) => c.projectId === activeProjectId)
    : [];
  const projectGrouped = groupConversationsByDate(
    search ? projectConversations.filter((c) => c.title?.toLowerCase().includes(search.toLowerCase())) : projectConversations
  );

  async function handleDelete(convId, e) {
    if (e) e.stopPropagation();
    setActiveMenu(null);
    setContextMenu(null);
    if (user) {
      const conv = conversations.find((c) => c.id === convId);
      if (conv?.projectId) {
        await removeConversationFromProject(user.uid, conv.projectId, convId);
      }
      await deleteConversation(user.uid, convId);
      if (currentConversationId === convId) startNewChat();
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
      setActiveProjectId(project.id);
      setCurrentConversationId(null);
      setSidebarOpen(false);
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
                  setCurrentConversationId(conv.id);
                  setSidebarOpen(false);
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
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        ref={sidebarRef}
        onMouseEnter={cancelHide}
        onMouseLeave={scheduleHide}
        className={`mira-sidebar ${sidebarOpen ? 'open' : ''} fixed inset-y-0 left-0 z-50 w-full lg:w-[280px] p-0 lg:p-3 flex flex-col h-full`}
      >
        <div className="flex flex-col h-full rounded-none lg:rounded-2xl overflow-hidden glass-strong">

          {/* Header */}
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {activeProjectId ? (
                <button
                  onClick={() => {
                    setActiveProjectId(null);
                    setCurrentConversationId(null);
                    setSidebarOpen(false);
                  }}
                  className="p-1.5 rounded-xl transition-all hover:scale-105"
                  style={{ color: 'var(--text-secondary)' }}
                  title="Back to all chats"
                >
                  <ArrowLeft size={18} />
                </button>
              ) : (
                <img src="/mira-logo.png" alt="MIRA" className="w-9 h-9 rounded-xl object-cover" />
              )}
              <div>
                <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                  {activeProjectId ? (activeProject?.name || 'Project') : 'MIRA'}
                </span>
                <p className="text-[10px] leading-tight" style={{ color: 'var(--text-tertiary)' }}>
                  {activeProjectId ? `${projectConversations.length} chats` : 'AI Assistant'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  startNewChat();
                  setSidebarOpen(false);
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

          {/* ── PROJECT WORKSPACE VIEW ── */}
          {activeProjectId ? (
            <div className="flex-1 overflow-y-auto px-2 space-y-3 pb-2">
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
                            {p.pin ? (
                              <button onClick={() => handleRemovePin(p)} className="flex items-center gap-2 w-full px-3 py-2 text-sm transition rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                                <Unlock size={13} /> Remove PIN
                              </button>
                            ) : (
                              <button onClick={() => handleSetPin(p)} className="flex items-center gap-2 w-full px-3 py-2 text-sm transition rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                                <Lock size={13} /> Set PIN
                              </button>
                            )}
                            <button onClick={() => handleDeleteProject(p)} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition rounded-lg">
                              <Trash2 size={13} /> Delete
                            </button>
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
                    setSidebarOpen(false);
                  }}
                  className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm transition-all rounded-lg"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <Settings size={14} /> Settings
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    setSidebarOpen(false);
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
    </>
  );
}
