# Navigation Invariant Reference

A destination should not simultaneously appear in competing navigation layers unless explicitly allowed.

Typical competing layers:
- sidebar/global navigation
- top-level product navigation
- feature-local tabs/subnavigation

Breadcrumb repetition can be legitimate and should be modeled separately.

Suggested normalized record:

```text
route-pattern
destination-href
navigation-scope
navigation-role
feature-family
allowed-duplication?
```

Suggested checks:
- no competing navigation owner for same destination,
- feature-local tabs only inside their route family,
- every route pattern has a rendered verification fixture,
- every intentional duplicate is explicitly allow-listed with a reason.

Dynamic routes should be enumerated from the router and tested with representative fixtures rather than a partial hand-written list.
