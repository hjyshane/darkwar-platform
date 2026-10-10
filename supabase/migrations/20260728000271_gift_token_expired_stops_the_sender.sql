-- 0271: a "token expired" answer from the Gift Center stops the sender instead
-- of being retried per claim.
--
-- On 2026-10-10 code.php began answering {"code":10006,"message":"system fail"}
-- to EVERY request - any uid, with or without the Usertoken header - where the
-- day before the same request answered E004/E006. The page's own table calls
-- 10006 "token expired". That is not about one player: nothing can be sent
-- until a person has looked, and retrying only spends each claim's four
-- attempts. So 10006 is a `stop` (the runner turns itself off with the reason,
-- the claim goes back untouched) rather than a `retry`.
--
-- dw-gift (gift/official.py) is changed the same way.

create or replace function internal.gift_classify(
  p_status int, p_content text, p_timed_out boolean, p_error text)
returns table (kind text, raw jsonb, error text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body jsonb;
  v_code text;
  v_num bigint;
begin
  if p_timed_out or p_status is null then
    return query select 'retry', jsonb_build_object('timed_out', coalesce(p_timed_out, false),
                                                   'error', p_error),
                        coalesce(p_error, 'no answer');
    return;
  end if;

  -- A block, not a verdict on this code: do not retry around it.
  if p_status in (403, 429, 503) then
    return query select 'stop', jsonb_build_object('http_status', p_status,
                                                   'body', left(coalesce(p_content, ''), 500)),
                        'the Gift Center answered HTTP ' || p_status;
    return;
  end if;

  begin
    v_body := p_content::jsonb;
  exception when others then
    return query select 'stop', jsonb_build_object('http_status', p_status,
                                                   'body', left(coalesce(p_content, ''), 500)),
                        'the Gift Center answered something that is not JSON';
    return;
  end;

  if jsonb_typeof(v_body) <> 'object' then
    return query select 'retry', jsonb_build_object('body', v_body), 'unexpected answer shape';
    return;
  end if;

  v_code := v_body ->> 'errorCode';
  if v_code is not null then
    return query select
      case v_code
        when 'ok' then 'done'
        when 'E004' then 'invalid'
        when 'E005' then 'expired'
        when 'E006' then 'already'
        -- E007 (a limit) is left as retry: whether it is per player or for the
        -- code is unknown, and it must not retire the code for everyone.
        else 'retry'
      end,
      v_body,
      case
        when v_code in ('ok', 'E006') then null
        when v_code in ('E004', 'E005', 'E007', 'E009', 'E001', 'E002', 'E003', 'E008')
          then v_code || ': ' || coalesce(v_body ->> 'message', '')
        else 'unrecognised errorCode ' || v_code
      end;
    return;
  end if;

  if (v_body ->> 'code') ~ '^[0-9]{1,9}$' then
    v_num := (v_body ->> 'code')::bigint;
    -- 10020 too frequent, 10022 account alert: ours to stop for. 10018 is about
    -- THIS player's id, so it fails the pair, not the runner.
    if v_num in (10006, 10020, 10022) then
      return query select 'stop', v_body, v_num || ': ' || coalesce(v_body ->> 'message', '');
      return;
    elsif v_num in (10018, 10007) then
      return query select 'retry', v_body, v_num || ': ' || coalesce(v_body ->> 'message', '');
      return;
    end if;
  end if;

  return query select 'retry', v_body, 'unrecognised answer';
end;
$$;
