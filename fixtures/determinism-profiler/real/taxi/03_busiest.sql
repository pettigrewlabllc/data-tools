SELECT zone, trips, round(avg_fare, 2) AS avg_fare FROM by_zone ORDER BY trips DESC LIMIT 10;
