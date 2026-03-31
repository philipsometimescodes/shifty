# Shifty Webapp Spec

## Overview
Shifty is a small webapp for managing shifts for a single event. Admins configure the event, define reusable shift types, schedule shifts, and review applications. Public users do not need an account and can apply with only a name and email address.

## Roles
- Admins log in to create the event, manage shift types, create and edit shifts, archive shifts, and review applications.
- Public users are unregistered visitors who can see only public shifts and submit one application per event.

## Event Model
- The app supports one event for now.
- The event has a name plus an admin-selected start date and end date.
- When event dates change, the UI warns admins if existing shifts would fall outside the new range.
- Shifts outside the current event range remain visible in the admin area until they are moved or archived.

## Shift Types
- Admins can create reusable shift types.
- Each shift type has a name, description, and default length in minutes.
- Shift types are scoped to the event and can be reused across many shifts.

## Shifts
- Admins create shifts by selecting a shift type.
- Each shift has a date, start time, end time, capacity, and explicit visibility setting.
- Visibility is manual: each shift is either public or internal. There are no automatic weekday rules.
- When a shift type and start time are selected in the admin UI, the end time is prefilled from the shift type's default length, but admins can override it.
- Shifts should normally sit inside the event range.
- If a shift already has applications, admins archive it instead of deleting it.

## Public Application Flow
- Public users can browse all non-archived public shifts inside the current event range.
- To apply, a user enters a name and email address.
- A given email address can submit only one application per event.
- Submitting an application immediately reserves one available space on the selected shift.
- After submission, the applicant receives a confirmation email.

## Application Review
- Every application has one of three statuses: Pending, Approved, or Rejected.
- Admins can view all applications across the event.
- Admins can change any application to Pending, Approved, or Rejected.
- Rejecting an application releases the reserved space back to the shift.
- When an application is approved, the applicant receives an approval email.
- Public users cannot edit or withdraw their own application.

## Admin Access
- Admin-only features require login.
- The current implementation uses a single seeded admin account from environment variables.

## Acceptance Criteria
- Admins can log in and create one named event with a start and end date.
- Admins can create reusable shift types with name, description, and default length.
- Admins can create shifts from a shift type with date, start time, end time, capacity, and explicit public or internal visibility.
- Admins can open shift creation and editing from the shifts section without leaving the dashboard context.
- The shift form prefills end time from the chosen shift type and start time, but admins can change it.
- Public users can only see non-archived shifts marked public and inside the event range.
- Public users can apply without registration by entering a name and email.
- The system blocks a second application from the same email within the same event.
- The system reduces available capacity when an application is submitted.
- Admins can review all applications and set them to Pending, Approved, or Rejected.
- Rejecting an application restores one free space to the related shift.
- The system sends a submission confirmation email and an approval email.