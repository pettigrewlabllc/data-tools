-- Adding doubles in a different order changes the last few digits.
SELECT sum(price) AS revenue FROM (SELECT price FROM arrivals);
