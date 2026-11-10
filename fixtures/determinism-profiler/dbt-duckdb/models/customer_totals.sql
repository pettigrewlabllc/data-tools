select c.customer_id, c.region, count(*) as orders, sum(o.amount) as total
from {{ ref('stg_orders') }} o
join {{ ref('customers') }} c using (customer_id)
group by c.customer_id, c.region
