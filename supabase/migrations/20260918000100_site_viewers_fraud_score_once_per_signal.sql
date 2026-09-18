-- yourrank:migration-phase: expand
-- Kick earn processing used to add the anti-fraud signal points on every
-- provider event, so a member whose username merely resembled a peer's was
-- auto-blocked after a few channel-point redemptions. Signals are now scored
-- once per membership. Rewind memberships that were blocked by that inflation
-- alone (block_reason made only of the automatic signal labels) to the score a
-- single evaluation produces. Creator-issued blocks carry a free-text reason
-- and are left untouched.
WITH auto_blocked AS (
  SELECT id, block_reason
    FROM public.site_viewers
   WHERE blocked = true
     AND block_reason IS NOT NULL
     AND block_reason LIKE '%auto-blocked by fraud score%'
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(string_to_array(block_reason, '; ')) AS part
        WHERE part NOT IN (
          'username reused by another Kick account',
          'username similar to existing viewer',
          'auto-blocked by fraud score'
        )
     )
)
UPDATE public.site_viewers sv
   SET blocked = false,
       fraud_score = (CASE WHEN ab.block_reason LIKE '%username reused by another Kick account%' THEN 50 ELSE 0 END)
                   + (CASE WHEN ab.block_reason LIKE '%username similar to existing viewer%' THEN 30 ELSE 0 END),
       block_reason = NULLIF(
         array_to_string(
           ARRAY(
             SELECT part
               FROM unnest(string_to_array(ab.block_reason, '; ')) AS part
              WHERE part <> 'auto-blocked by fraud score'
           ),
           '; '
         ),
         ''
       ),
       updated_at = now()
  FROM auto_blocked ab
 WHERE sv.id = ab.id;
