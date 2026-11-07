// public/js/config/supabase.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qfhzjuwxpdohmtdtzosp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmaHpqdXd4cGRvaG10ZHR6b3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NzQyNjAsImV4cCI6MjA5ODI1MDI2MH0.Q9fU-OiazQw06EuPWIHnkHbmJpGqW94Bn3DVcXqCixU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);