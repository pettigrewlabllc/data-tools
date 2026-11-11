-- Half the orders, for a quicker report. No seed.
select *
from {{ ref('stg_orders') }}
using sample 50% (bernoulli)
