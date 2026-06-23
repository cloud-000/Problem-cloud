-- sticky: stays until the user clicks X
insert into notifications (title, message, payload)
values ('Action required', 'Verify your email', '{"type":"error","duration":0}'::jsonb);