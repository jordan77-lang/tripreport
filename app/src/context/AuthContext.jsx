import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { setSignedInUser } from '../lib/authUser';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async (userId) => {
    if (!supabase || !userId) {
      setProfile(null);
      setSignedInUser(null);
      return null;
    }

    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;

      const next = data || null;
      setProfile(next);
      setSignedInUser(userId, next?.display_name || null);
      return next;
    } catch (e) {
      console.error('Failed to load profile', e);
      setProfile(null);
      setSignedInUser(userId, null);
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setLoading(false);
      setSignedInUser(null);
      return undefined;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      if (data.session?.user?.id) {
        void loadProfile(data.session.user.id);
      } else {
        setSignedInUser(null);
      }
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user?.id) {
        void loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
        setSignedInUser(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signInWithEmail = useCallback(async (email) => {
    requireSupabase();
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  }, []);

  const signInWithPassword = useCallback(async (email, password) => {
    requireSupabase();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
  }, []);

  const signUpWithPassword = useCallback(async (email, password) => {
    requireSupabase();
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
      },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setProfile(null);
    setSignedInUser(null);
  }, []);

  const upsertProfile = useCallback(async (displayName) => {
    const userId = session?.user?.id;
    if (!userId) throw new Error('Sign in required');

    requireSupabase();
    const trimmed = displayName.trim();
    if (!trimmed) throw new Error('Display name is required');

    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        display_name: trimmed,
        updated_at: new Date().toISOString(),
      })
      .select('id, display_name, created_at, updated_at')
      .single();

    if (error) throw error;
    setProfile(data);
    setSignedInUser(userId, data.display_name);
    return data;
  }, [session?.user?.id]);

  const value = useMemo(() => ({
    configured: supabaseConfigured,
    loading,
    profileLoading,
    session,
    user: session?.user ?? null,
    profile,
    isSignedIn: Boolean(session?.user),
    needsProfile: Boolean(session?.user) && !profile?.display_name?.trim(),
    signInWithEmail,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    upsertProfile,
    refreshProfile: () => loadProfile(session?.user?.id),
  }), [
    loading, profileLoading, session, profile,
    signInWithEmail, signInWithPassword, signUpWithPassword,
    signOut, upsertProfile, loadProfile,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured');
}
