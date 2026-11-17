---
title: 带 MAX 的标量子查询改写为 LEFT JOIN
date: 2026-11-17
description: 先按关联键求最大值，再连回明细表。用无匹配、全空值和 COUNT 的例子核对改写前后的结果。
tags:
  - SQL 优化
---

按外层行重复查询最大值时，可以先按关联键算出每组的 `MAX`，再把结果连回外层表。

```sql
SELECT a.a1,
       (SELECT MAX(b.b2) FROM test_lg2 b WHERE b.a2 = a.a1) AS max_b2
FROM test_lg1 a;

SELECT a.a1, g.max_b2
FROM test_lg1 a
LEFT JOIN (
  SELECT b.a2, MAX(b.b2) AS max_b2
  FROM test_lg2 b
  GROUP BY b.a2
) g ON g.a2 = a.a1;
```

分组后，每个关联键最多有一行。外层关联键没有匹配时，`LEFT JOIN` 保留这一行，`max_b2` 仍为 `NULL`。内层匹配行的 `b2` 全是 `NULL` 时，两个写法也都返回 `NULL`。如果改写的是 `COUNT(*)`，要用 `COALESCE(g.row_count, 0)` 把未匹配时的 `NULL` 转回原查询返回的 `0`。

原达梦案例的执行计划在带外层变量的分支中执行聚合。评估改写时，可以在目标数据库分别测外层只返回少量行和返回大量行的情况。前一种情况下，按索引查少量分组可能比预先聚合整张内表更省。
