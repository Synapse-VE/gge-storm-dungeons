/**
 * environment.ts
 * This file contains environment variables for the development environment.
 * It is used during the build process when the `--configuration=development` flag is provided.
 * For production builds, `environment.production.ts` is used instead.
 */
// No local i18n checkout in this fork: use the published one.
const useLocalI18n = false;

export const environment = {
  production: false,
  apiUrl: '',
  i18nBaseUrl: 'https://ggetracker.github.io/i18n/',
  supabaseUrl: 'https://nadunymqjnzjfyytvfro.supabase.co',
  supabaseAnonKey: 'sb_publishable_o2-Nc6dBJp7QpD2wLwtGZg_46zAOHEP',
};

console.log('Using development environment');
