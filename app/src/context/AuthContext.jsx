import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { setSignedInUser } from '../lib/authUser';

const AuthContext = createContext(null);
function cachedProfile(id) { try { return JSON.parse(localStorage.getItem('tr_profile:'+id)||'null'); } catch { return null; } }
function cacheProfile(profile) { if(profile?.id) { try {localStorage.setItem('tr_profile:'+profile.id,JSON.stringify(profile));} catch { /* Cache is optional. */ } } }
function offlineSession(networkFailed=false) { try {return (networkFailed || navigator.onLine === false) ? JSON.parse(localStorage.getItem('tr_offline_identity')||'null') : null;} catch {return null;} }
function cacheIdentity(session) { if(session?.user && !session.offline) {try {localStorage.setItem('tr_offline_identity',JSON.stringify({user:{id:session.user.id,email:session.user.email},offline:true}));}catch{ /* Cache is optional. */ }} }


export function AuthProvider({ children }) {
  const profileRequest = useRef(0);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async (userId) => {
    const request=++profileRequest.current;
    if (!supabase || !userId) {
      setProfile(null);
      setSignedInUser(null);
      return null;
    }

    const cached = cachedProfile(userId);
    setProfile(cached);
    setSignedInUser(userId,cached?.display_name || null);
    setProfileLoading(!cached);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      if(request!==profileRequest.current)return null;

      const next = data || null;
      cacheProfile(next);
      setProfile(next);
      setSignedInUser(userId, next?.display_name || null);
      return next;
    } catch (e) {
      if(request!==profileRequest.current)return null;
      console.error('Failed to load profile', e);
      setProfile(cached);
      setSignedInUser(userId, cached?.display_name || null);
      return cached;
    } finally {
      if(request===profileRequest.current)setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setLoading(false);
      setSignedInUser(null);
      return undefined;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      const restored = data.session || offlineSession(Boolean(error));
      cacheIdentity(restored);
      setSession(restored);
      if (restored?.user?.id) {
        void loadProfile(restored.user.id);
      } else {
        setSignedInUser(null);
      }
      setLoading(false);
    }).catch(() => {
      if(!mounted)return;
      const restored=offlineSession(true);setSession(restored);
      if(restored?.user?.id)void loadProfile(restored.user.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if(_event === 'SIGNED_OUT') localStorage.removeItem('tr_offline_identity');
      nextSession = nextSession || (_event !== 'SIGNED_OUT' ? offlineSession() : null);
      cacheIdentity(nextSession);
      setSession(nextSession);
      if (nextSession?.user?.id) {
        void loadProfile(nextSession.user.id);
      } else {
        profileRequest.current++;
        setProfile(null);
        setSignedInUser(null);
      }
    });

    return () => {
      mounted = false;
      profileRequest.current++;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signInWithEmail = useCallback(async (email) => {
    requireSupabase();
    const redirectUrl = new URL(window.location.pathname, window.location.origin);
    const inviteCode = new URLSearchParams(window.location.search).get('join') || new URLSearchParams(window.location.search).get('code');
    if (inviteCode) redirectUrl.searchParams.set('join', inviteCode);
    const redirectTo = redirectUrl.toString();
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
    profileRequest.current++;
    localStorage.removeItem('tr_offline_identity');
    const id=session?.user?.id;
    if(id)localStorage.removeItem('tr_profile:'+id);
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setSignedInUser(null);
  }, [session?.user?.id]);

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
    cacheProfile(data);
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
