// js/auth.js

// ============ LOGIN ============
async function signIn(email, password, role) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    showError('Login failed: ' + error.message);
    return null;
  }

  const profile = await getUserProfile(data.user.id);
  if (!profile) {
    showError('Profile not found. Contact your administrator.');
    await supabase.auth.signOut();
    return null;
  }

  if (profile.role !== role) {
    showError(`This account is registered as ${profile.role}, not ${role}.`);
    await supabase.auth.signOut();
    return null;
  }

  window.location.href = 'dashboard.html';
  return data.user;
}

// ============ SIGN UP ============
async function signUp(email, password, fullName, role, clientId) {
  const { data, error } = await supabase.auth.signUp({
    email: email,
    password: password,
    options: {
      data: {
        full_name: fullName,
        role: role
      }
    }
  });

  if (error) {
    showError('Sign up failed: ' + error.message);
    return null;
  }

  if (role === 'client' && clientId && data.user) {
    await supabase
      .from('profiles')
      .update({ client_id: clientId })
      .eq('id', data.user.id);
  }

  showSuccess('Account created. Redirecting to dashboard...');
  setTimeout(() => window.location.href = 'dashboard.html', 1500);
  return data.user;
}

// ============ SIGN OUT ============
async function signOut() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

// ============ FORGOT PASSWORD ============
async function forgotPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password.html'
  });

  if (error) {
    showError('Could not send reset email: ' + error.message);
    return false;
  }

  showSuccess('Password reset email sent. Check your inbox.');
  return true;
}

// ============ UI HELPERS ============
function showError(message) {
  if (typeof toast === 'function') {
    toast('alert', 'Error', message);
  } else {
    alert('Error: ' + message);
  }
}

function showSuccess(message) {
  if (typeof toast === 'function') {
    toast('success', 'Success', message);
  } else {
    alert(message);
  }
}

// ============ ON LOGIN PAGE LOAD ============
async function checkExistingSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    window.location.href = 'dashboard.html';
  }
}

if (window.location.pathname.includes('index.html') ||
    window.location.pathname === '/') {
  checkExistingSession();
}