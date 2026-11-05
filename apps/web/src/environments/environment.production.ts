/**
 * environment.production.ts
 * This file contains environment variables for the production environment.
 * It is used during the build process when the `--configuration=production` flag is provided.
 * For development builds, `environment.ts` is used instead.
 */
export const environment = {
  production: true,
  apiUrl: '',
  i18nBaseUrl: 'https://ggetracker.github.io/i18n/',
  supabaseUrl: 'https://nadunymqjnzjfyytvfro.supabase.co',
  supabaseAnonKey: 'sb_publishable_o2-Nc6dBJp7QpD2wLwtGZg_46zAOHEP',
};
console.clear();
const myColor = 'color:#e65045; font-size:15px;';
console.log(
  "%cHello there! 👋  If you're interested to contribute to this project, feel free to visit the 'about' page",
  myColor,
);
