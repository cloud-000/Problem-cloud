# Authentication

## Google OAuth

ProblemCloud uses Supabase Auth as the Google OAuth callback. Configure Google
Cloud with this authorized redirect URI (replace the project reference in
production):

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

For local Supabase, add:

```text
http://127.0.0.1:54321/auth/v1/callback
```

In Supabase Dashboard, enable the Google provider, supply the Google client ID
and secret, and add each deployed ProblemCloud callback URL to Auth redirect
URLs:

```text
https://<problemcloud-host>/auth/callback
```

Local credentials are read by `supabase/config.toml` from
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`. Keep both out of version control.

The app validates a Google sign-up username before OAuth begins, then claims it
atomically after Supabase returns the authenticated session. A user whose
callback is interrupted is directed to `/auth/complete-profile` until their
username is claimed.
