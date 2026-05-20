import { useEffect, useState } from 'react';

function getInitial(profile = {}) {
  return (profile.displayName?.[0] || profile.email?.[0] || '?').toUpperCase();
}

export default function UserAvatar({ profile, size = 36, className = '', rounded = 'rounded-xl', title }) {
  const [failed, setFailed] = useState(false);
  const photoURL = typeof profile?.photoURL === 'string' ? profile.photoURL.trim() : '';
  const showPhoto = photoURL && !failed;

  useEffect(() => {
    setFailed(false);
  }, [photoURL]);

  return (
    <div
      className={`relative flex flex-shrink-0 items-center justify-center overflow-hidden ${rounded} ${className}`}
      style={{
        width: size,
        height: size,
        background: 'var(--avatar-bg)',
        color: 'var(--btn-primary-text)',
        border: '1px solid var(--glass-border)',
      }}
      title={title || profile?.displayName || profile?.email || 'User'}
      aria-label={title || profile?.displayName || profile?.email || 'User'}
    >
      {showPhoto ? (
        <img
          src={photoURL}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="select-none text-sm font-bold leading-none">
          {getInitial(profile)}
        </span>
      )}
    </div>
  );
}