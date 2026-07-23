# Inventory HTTP contract v1

Consumers use the public gateway path `https://api.skincos.com.br/inventory/*`
or a contract test double. They must not import `inventory/src/**` or route
handlers directly. Inventory owns path normalization, authorization,
persistence and error details.

For a contract test, model the HTTP response at the gateway boundary and assert
status, response body and correlation header. Do not share Inventory's internal
route handler with CRM tests.
