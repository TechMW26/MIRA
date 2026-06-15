import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { subscribeUserProfile } from '../services/database';

export default function useUserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!user?.uid) {
      setProfile(null);
      return undefined;
    }

    return subscribeUserProfile(user.uid, setProfile);
  }, [user?.uid]);

  return useMemo(() => ({
    uid: user?.uid || '',
    email: profile?.email || user?.email || '',
    displayName: profile?.displayName || user?.displayName || '',
    phone: profile?.phone || '',
    photoURL: profile?.photoURL || user?.photoURL || '',
    bio: profile?.bio || '',
    age: profile?.age ?? null,
    gender: profile?.gender || '',
    preferences: profile?.preferences || {},
  }), [profile, user]);
}