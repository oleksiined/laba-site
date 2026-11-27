-- v1 (4 args) replaced by apply_sample_transition_v2; nothing calls it any more.
drop function if exists public.apply_sample_transition(uuid, text, int[], text);
