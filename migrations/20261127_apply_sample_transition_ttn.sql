-- v2 of apply_sample_transition: accept also stores the TTN on the sample.
-- The v1 function (4 args) is kept until it can be dropped separately.

-- Locks the order row, validates the state machine and updates samples + order
-- status in one step, so two admins can no longer overwrite each other's changes
-- and an accepted sample can never be downgraded to "received".

create or replace function public.apply_sample_transition_v2(
  p_order_id uuid,
  p_action   text,
  p_indices  int[],
  p_lab      text default null,
  p_ttn      text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o            public.orders%rowtype;
  samples_new  jsonb := '[]'::jsonb;
  s            jsonb;
  i            int;
  n            int;
  cur          text;
  allowed      text[];
  done_states  text[];
  applied      int[] := '{}';
  names        jsonb := '[]'::jsonb;
  new_status   text;
  ts           text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_action not in ('receive', 'accept') then
    return jsonb_build_object('ok', false, 'error', 'Invalid action');
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;
  if o.samples is null or jsonb_typeof(o.samples) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'Order has no samples');
  end if;

  if p_action = 'receive' then
    allowed     := array['new'];
    done_states := array['received', 'accepted', 'work', 'done'];
  else
    allowed     := array['new', 'received'];
    done_states := array['accepted', 'work', 'done'];
  end if;

  n := jsonb_array_length(o.samples);
  for i in 0 .. n - 1 loop
    s   := o.samples -> i;
    cur := coalesce(s ->> 'st', 'new');
    if i = any (coalesce(p_indices, '{}')) and cur = any (allowed) then
      if p_action = 'receive' then
        s := s || jsonb_build_object('st', 'received', 'updated_at', ts);
      else
        s := s || jsonb_build_object('st', 'accepted', 'accepted_at', ts);
        if coalesce(p_lab, '') <> '' then
          s := s || jsonb_build_object('lab', p_lab);
        end if;
        if coalesce(p_ttn, '') <> '' then
          s := s || jsonb_build_object('ttn', p_ttn);
        end if;
      end if;
      applied := applied || i;
      names   := names || to_jsonb(coalesce(nullif(s ->> 'name', ''), 'Зразок ' || (i + 1)));
    end if;
    samples_new := samples_new || jsonb_build_array(s);
  end loop;

  if coalesce(array_length(applied, 1), 0) = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', case p_action
                 when 'receive' then 'Обрані зразки вже отримані або в роботі'
                 else 'Обрані зразки вже прийняті або в роботі'
               end
    );
  end if;

  new_status := o.status;
  if not exists (
    select 1 from jsonb_array_elements(samples_new) e
    where coalesce(e ->> 'st', 'new') <> all (done_states)
  ) then
    if p_action = 'receive' and o.status = 'waiting' then
      new_status := 'work';
    elsif p_action = 'accept' and o.status in ('new', 'waiting') then
      new_status := 'work';
    end if;
  end if;

  update public.orders
     set samples = samples_new,
         status  = new_status
   where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'order_num', o.order_num,
    'applied', to_jsonb(applied),
    'names', names,
    'old_status', o.status,
    'new_status', new_status
  );
end;
$$;

revoke execute on function public.apply_sample_transition_v2(uuid, text, int[], text, text) from public, anon, authenticated;
grant  execute on function public.apply_sample_transition_v2(uuid, text, int[], text, text) to service_role;
