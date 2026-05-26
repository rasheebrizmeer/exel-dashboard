const SUPABASE_URL = 'https://tbizdahnximtzkndzfgd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiaXpkYWhueGltdHprbmR6ZmdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NDQ5MzQsImV4cCI6MjA5NTIyMDkzNH0.8hWV_tVM2Ah1A25Mn-lt4kkr6cuBVsM-lfHaiAqbZFQ';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  return session.user;
}

async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('Profile fetch error:', error);
    return null;
  }
  return data;
}