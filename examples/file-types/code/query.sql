SELECT name, COUNT(*) AS total
FROM orders
GROUP BY name;
