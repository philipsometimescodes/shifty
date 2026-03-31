## Plan: Current Shifty MVP

Build and maintain a small shift planner for one named event with a protected admin dashboard and a public signup flow. The product now uses a configurable event range, reusable shift types, explicit public or internal shift visibility, and a one-application-per-email-per-event rule.

**Product Shape**
1. One named event with admin-controlled start and end dates.
2. Reusable shift types with name, description, and default length.
3. Shifts created from a shift type with date, start time, end time, capacity, and explicit visibility.
4. Public users can only see shifts marked public and inside the current event range.
5. Applications reserve capacity immediately and move through Pending, Approved, and Rejected states.

**Implementation Areas**
1. Admin authentication with a single seeded account from environment variables.
2. Event setup with a name, date-range editing, and warnings when existing shifts fall outside the new range.
3. Shift type management in the admin dashboard.
4. Shift creation, editing, and archiving in the admin dashboard.
5. Public application flow with name and email only.
6. Email notifications for submission confirmation and approval.

**Rules To Preserve**
1. Only one event is supported for now.
2. No automatic weekday rules decide whether a shift is public.
3. A shift can be public or internal regardless of the day.
4. One email address can apply only once per event.
5. Rejecting an application releases the reserved space.
6. Public users cannot edit or withdraw their own applications.
7. Shifts with applications should be archived instead of deleted.

**Validation Checklist**
1. Event dates must form a valid start and end range.
2. Shift dates should stay inside the event range unless the admin intentionally leaves older shifts to clean up after a range change.
3. Shift end time must be after shift start time.
4. Capacity cannot drop below the number of already reserved applications.
5. Public endpoints must only expose non-archived public shifts inside the current event range.

**Current Deliverables**
1. Root spec aligned with the latest product rules.
2. React admin and public UI aligned with the backend API.
3. Express and Prisma backend aligned with reusable shift types and explicit visibility.
4. README aligned with the current user-facing feature set.
