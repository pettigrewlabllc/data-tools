{{ config(materialized='table') }}
select c.region, count(*) as orders, round(sum(o.amount), 2) as revenue
from {{ ref('sampled_orders') }} o
join {{ ref('customers') }} c using (customer_id)
group by c.region
