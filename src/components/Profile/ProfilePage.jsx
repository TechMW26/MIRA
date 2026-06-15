import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  User,
  Mail,
  Phone,
  Trash2,
  Save,
  Loader2,
  X,
  Palette,
  Bell,
  Shield,
  ChevronRight,
  Cake,
  UserCircle2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useChatContext } from '../../contexts/ChatContext';
import { getUserProfile, updateUserProfile } from '../../services/database';

export default function SettingsModal({ onClose }) {
  const { user, logout } = useAuth();

  const [profile, setProfile] = useState({
    displayName: '',
    email: '',
    phone: '',
    photoURL: '',
    bio: '',
    age: '',
    gender: '',
  });
  const [preferences, setPreferences] = useState({
    responseStyle: 'balanced',
    codeTheme: 'auto',
    fontSize: 'medium',
    notifications: true,
    streamResponses: true,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState('profile');
  const [photoPreview, setPhotoPreview] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    loadProfile();
  }, [user]);

  async function loadProfile() {
    const data = await getUserProfile(user.uid);
    if (data) {
      setProfile({
        displayName: data.displayName || '',
        email: data.email || user.email || '',
        phone: data.phone || '',
        photoURL: data.photoURL || '',
        bio: data.bio || '',
        age: data.age != null ? String(data.age) : '',
        gender: data.gender || '',
      });
      if (data.preferences) {
        setPreferences((prev) => ({ ...prev, ...data.preferences }));
        localStorage.setItem('mira_preferences', JSON.stringify({ ...preferences, ...data.preferences }));
        window.dispatchEvent(new Event('mira-preferences-changed'));
      }
      if (data.photoURL) setPhotoPreview(data.photoURL);
    } else {
      setProfile((prev) => ({ ...prev, email: user.email || '', displayName: user.displayName || '' }));
    }
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      const ageNum = profile.age ? Number(profile.age) : null;
      await updateUserProfile(user.uid, {
        displayName: profile.displayName,
        phone: profile.phone,
        photoURL: profile.photoURL,
        bio: profile.bio,
        age: Number.isFinite(ageNum) && ageNum > 0 && ageNum < 130 ? ageNum : null,
        gender: profile.gender || '',
        preferences,
      });
      // Persist preferences to localStorage for instant access by engine/UI
      localStorage.setItem('mira_preferences', JSON.stringify(preferences));
      window.dispatchEvent(new Event('mira-preferences-changed'));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      alert('Photo must be under 500KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result;
      setPhotoPreview(base64);
      setProfile((prev) => ({ ...prev, photoURL: base64 }));
    };
    reader.readAsDataURL(file);
  }

  const sections = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'preferences', label: 'Preferences', icon: Bell },
    { id: 'account', label: 'Account', icon: Shield },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 backdrop-blur-sm animate-fade-in" style={{ background: 'var(--overlay-bg)' }} onClick={onClose} />

      {/* Modal — full-screen on mobile, wide centered panel on desktop */}
      <div
        className="relative z-10 w-full h-full lg:w-[780px] lg:h-[80vh] lg:rounded-2xl overflow-hidden flex flex-col animate-fade-in"
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', boxShadow: '0 25px 60px var(--glass-shadow)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 lg:hidden" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Settings</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saved ? 'Saved' : 'Save'}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl transition-all hover:opacity-70"
              style={{ color: 'var(--text-secondary)' }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Mobile: horizontal tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-2 overflow-x-auto scrollbar-none lg:hidden">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200"
              style={activeSection === s.id ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' } : { color: 'var(--text-secondary)' }}
            >
              <s.icon size={15} />
              {s.label}
            </button>
          ))}
        </div>

        {/* Desktop: sidebar + content layout */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar nav (desktop only) */}
          <div className="hidden lg:flex flex-col w-[200px] flex-shrink-0 py-4 px-3 gap-1" style={{ borderRight: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-2 mb-4">
              <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Settings</h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg transition-all hover:opacity-70"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <X size={16} />
              </button>
            </div>
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-all duration-200"
                style={activeSection === s.id ? { background: 'var(--hover-bg)', color: 'var(--text-primary)' } : { color: 'var(--text-secondary)' }}
              >
                <s.icon size={16} />
                {s.label}
              </button>
            ))}

            {/* Save button at bottom of sidebar */}
            <div className="mt-auto pt-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-5 lg:px-8 py-4 lg:py-6">
        {/* Profile section */}
        {activeSection === 'profile' && (
          <div className="space-y-6 animate-fade-in">
            {/* Photo */}
            <div className="flex flex-col items-center gap-4">
              <div className="relative group">
                <div className="w-24 h-24 rounded-2xl overflow-hidden" style={{ border: '3px solid var(--glass-border)' }}>
                  {photoPreview ? (
                    <img src={photoPreview} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl font-bold" style={{ background: 'var(--avatar-bg)', color: 'var(--btn-primary-text)' }}>
                      {profile.displayName?.[0]?.toUpperCase() || profile.email?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-2 -right-2 w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                  style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
                >
                  <Camera size={14} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-4">
              <FormField icon={User} label="Display Name" value={profile.displayName} onChange={(v) => setProfile((p) => ({ ...p, displayName: v }))} placeholder="Your name" />
              <FormField icon={Mail} label="Email" value={profile.email} disabled note="Email cannot be changed" />
              <FormField icon={Phone} label="Phone Number" value={profile.phone} onChange={(v) => setProfile((p) => ({ ...p, phone: v }))} placeholder="+1 234 567 890" type="tel" />
              <div className="grid grid-cols-2 gap-3">
                <FormField icon={Cake} label="Age" value={profile.age} onChange={(v) => setProfile((p) => ({ ...p, age: v.replace(/[^0-9]/g, '').slice(0, 3) }))} placeholder="e.g. 24" type="text" />
                <SelectField icon={UserCircle2} label="Gender" value={profile.gender} onChange={(v) => setProfile((p) => ({ ...p, gender: v }))} options={[
                  { value: '', label: 'Prefer not to say' },
                  { value: 'female', label: 'Female' },
                  { value: 'male', label: 'Male' },
                  { value: 'non-binary', label: 'Non-binary' },
                  { value: 'other', label: 'Other' },
                ]} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 tracking-wide uppercase" style={{ color: 'var(--text-tertiary)' }}>Bio</label>
                <textarea
                  value={profile.bio}
                  onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
                  placeholder="Tell MIRA a bit about yourself..."
                  rows={3}
                  className="w-full glass-input rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200 focus:ring-1 focus:ring-[var(--border)] resize-none"
                  style={{ color: 'var(--text-primary)' }}
                  maxLength={300}
                />
                <span className="text-[11px] mt-1 block" style={{ color: 'var(--text-tertiary)' }}>{profile.bio.length}/300</span>
              </div>
            </div>
          </div>
        )}

        {/* Appearance section */}
        {activeSection === 'appearance' && (
          <div className="space-y-6 animate-fade-in">
            <div className="glass-subtle rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Text Size</h3>
              <div className="flex gap-2">
                {['small', 'medium', 'large'].map((size) => (
                  <button
                    key={size}
                    onClick={() => setPreferences((p) => ({ ...p, fontSize: size }))}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium capitalize transition-all duration-200 ${
                      preferences.fontSize === size
                        ? ''
                        : ''
                    }`}
                    style={preferences.fontSize === size ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' } : { color: 'var(--text-secondary)', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            <div className="glass-subtle rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Code Theme</h3>
              <div className="flex gap-2">
                {['auto', 'dark', 'light'].map((ct) => (
                  <button
                    key={ct}
                    onClick={() => setPreferences((p) => ({ ...p, codeTheme: ct }))}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium capitalize transition-all duration-200 ${
                      preferences.codeTheme === ct
                        ? ''
                        : ''
                    }`}
                    style={preferences.codeTheme === ct ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' } : { color: 'var(--text-secondary)', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                  >
                    {ct}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Preferences section */}
        {activeSection === 'preferences' && (
          <div className="space-y-4 animate-fade-in">
            <div className="glass-subtle rounded-2xl p-5 space-y-5">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>AI Response Style</h3>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'concise', label: 'Concise', desc: 'Short & direct' },
                  { key: 'balanced', label: 'Balanced', desc: 'Detailed yet clear' },
                  { key: 'detailed', label: 'Detailed', desc: 'In-depth analysis' },
                ].map((style) => (
                  <button
                    key={style.key}
                    onClick={() => setPreferences((p) => ({ ...p, responseStyle: style.key }))}
                    className="p-3 rounded-xl text-left transition-all duration-200"
                    style={{ background: preferences.responseStyle === style.key ? 'var(--btn-primary-bg)' : 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                  >
                    <div className="text-sm font-medium" style={{ color: preferences.responseStyle === style.key ? 'var(--btn-primary-text)' : 'var(--text-primary)' }}>{style.label}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: preferences.responseStyle === style.key ? 'var(--btn-primary-text)' : 'var(--text-tertiary)', opacity: preferences.responseStyle === style.key ? 0.7 : 1 }}>{style.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <ToggleRow label="Stream responses" desc="Show AI responses as they generate" value={preferences.streamResponses} onChange={(v) => setPreferences((p) => ({ ...p, streamResponses: v }))} />
            <ToggleRow label="Notifications" desc="Get notified when AI finishes long tasks" value={preferences.notifications} onChange={(v) => setPreferences((p) => ({ ...p, notifications: v }))} />
          </div>
        )}

        {/* Account section */}
        {activeSection === 'account' && (
          <div className="space-y-4 animate-fade-in">
            <div className="glass-subtle rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Account Info</h3>
              <div className="space-y-2">
                <InfoRow label="Email" value={profile.email} />
                <InfoRow label="User ID" value={user?.uid} />
                <InfoRow label="Member since" value={new Date().toLocaleDateString()} />
              </div>
            </div>

            <div className="glass-subtle rounded-2xl p-5">
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Danger Zone</h3>
              <button
                onClick={() => { logout(); onClose(); }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium text-red-400 transition-all hover:bg-red-500/10"
                style={{ border: '1px solid rgba(239,68,68,0.2)' }}
              >
                <span>Sign out of MIRA</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
        </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────

function FormField({ icon: Icon, label, value, onChange, placeholder, type = 'text', disabled, note }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5 tracking-wide uppercase" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </label>
      <div className="relative">
        <Icon size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full glass-input rounded-xl pl-10 pr-4 py-3 text-sm outline-none transition-all duration-200 focus:ring-1 focus:ring-[var(--border)] ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          style={{ color: 'var(--text-primary)' }}
        />
      </div>
      {note && <span className="text-[11px] mt-1 block" style={{ color: 'var(--text-tertiary)' }}>{note}</span>}
    </div>
  );
}

function SelectField({ icon: Icon, label, value, onChange, options = [] }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5 tracking-wide uppercase" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </label>
      <div className="relative">
        <Icon size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-tertiary)' }} />
        <select
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className="w-full glass-input rounded-xl pl-10 pr-4 py-3 text-sm outline-none transition-all duration-200 focus:ring-1 focus:ring-[var(--border)] appearance-none cursor-pointer"
          style={{ color: 'var(--text-primary)' }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, value, onChange }) {
  return (
    <div className="glass-subtle rounded-2xl p-5 flex items-center justify-between">
      <div>
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className="relative w-11 h-6 rounded-full transition-all duration-300"
        style={{ background: value ? 'var(--btn-primary-bg)' : 'var(--bg-tertiary)', border: value ? 'none' : '1px solid var(--glass-border)' }}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${value ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}
