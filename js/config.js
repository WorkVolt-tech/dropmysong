// DropMySong Supabase client configuration.
// The anon/public key is safe to use in the browser when Row Level Security (RLS) is enabled.
export const SUPABASE_URL = 'https://bnynovporbxpbpeflsnc.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJueW5vdnBvcmJ4cGJwZWZsc25jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMzY0MDUsImV4cCI6MjEwNjcxMjQwNX0.0cgr_0vxVcnNRR7e8cWZWlzbuQkXjy5OpyJMlPnqp8g';

// DJ Maxo payment destinations. These are public because guests need them to pay.
export const PAYPAL_ME_URL = 'https://paypal.me/chezmaxo';
export const ETRANSFER_EMAIL = 'djmaxo4fun@gmail.com';

// Public Web Push key. The matching private key belongs only in Supabase Edge Function secrets.
export const VAPID_PUBLIC_KEY = 'BO8IZ-TMjvy30E8cVv_NebstSju7N0gu3KjuvsnBOvBX-i1-_ZuCUFNn6ZeLJdqMMvwPdkDA8Bmn0O3omCvAr90';
