// EmPT settings. Fill these in from your Supabase project:
// Supabase dashboard -> Project Settings -> API (or "Data API" / "API Keys").
// Both values are designed to be public; your data is protected by the
// access rules in supabase/schema.sql.
export const SUPABASE_URL = 'https://xdhasuxmcvvsikquofcm.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_v-eg_rA9Jxwj2jng2qvgZA_-cdTKF2f';

// Shown to your clients in the app.
export const APP_NAME = 'EmPT';
export const TRAINER_NAME = 'Emily';

// Percentage-based weights (e.g. 70% of 1RM) are rounded to this many kg,
// so they can be loaded with real plates. 2.5 suits most gyms; use 1 or
// 1.25 if you have small change plates.
export const ROUND_TO_KG = 2.5;

// Clients cancelling with less than this many hours' notice see a gentle
// reminder that your cancellation policy may apply. (They can still cancel.)
export const LATE_CANCEL_HOURS = 24;

// Plates available in your gym (kg, per plate). Used by the plate
// calculator on barbell exercises. Remove any you don't have.
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];
