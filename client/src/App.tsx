import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useState } from "react";
import { de } from "date-fns/locale";
import DatePicker from "react-datepicker";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";

type EventRecord = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  adminEmailSubjectTemplate?: string;
  adminEmailBodyTemplate?: string;
  outOfRangeShiftCount?: number;
};

type ShiftTypeRecord = {
  id: string;
  eventId: string;
  name: string;
  description: string;
  defaultLengthMinutes: number;
  shiftCount: number;
};

type ApplicationStatus = "PENDING" | "APPROVED" | "REJECTED";

type ShiftApplication = {
  id: string;
  name: string;
  email: string;
  status: ApplicationStatus;
  emailSent: boolean;
  createdAt: string;
};

type Shift = {
  id: string;
  eventId: string;
  shiftType: ShiftTypeRecord;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  capacity: number;
  archived: boolean;
  isPublic: boolean;
  insideEventRange: boolean;
  reservedCount: number;
  availableSpaces: number;
  applications: ShiftApplication[];
};

type PublicResponse = {
  event: EventRecord | null;
  shifts: Shift[];
};

type DashboardResponse = {
  event: EventRecord | null;
  shiftTypes: ShiftTypeRecord[];
  shifts: Shift[];
  applications: Array<
    ShiftApplication & {
      shiftId: string;
      shiftTypeName: string;
      shiftDate: string;
      shiftStartTime: string;
      shiftEndTime: string;
      isPublic: boolean;
    }
  >;
};

type SessionResponse = {
  authenticated: boolean;
  email?: string;
};

type ShiftImportResponse = {
  importedShiftCount: number;
  upsertedShiftTypeCount: number;
  replaceExisting: boolean;
};

type TimelineZoomLevel = "overview" | "balanced" | "detail";

const defaultFestivalName = "Festival 2026";
const defaultFestivalStartDate = "2026-06-08";
const defaultFestivalEndDate = "2026-06-17";
const defaultAdminEmailSubjectTemplate = "Infos zu deiner Schicht bei {eventName}";
const defaultAdminEmailBodyTemplate = "Hallo {name},\n\nhier sind deine Infos fuer deine Schicht {shiftType} am {shiftDate} von {shiftStartTime} bis {shiftEndTime}.\n\nSichtbarkeit: {visibility}\nEvent: {eventName}\n\nViele Gruesse";

const timelineZoomOrder: TimelineZoomLevel[] = ["overview", "balanced", "detail"];

const timelineZoomOptions: Record<TimelineZoomLevel, { label: string; hourWidth: number; labeledHourStep: number }> = {
  overview: {
    label: "Weit",
    hourWidth: 8,
    labeledHourStep: 4
  },
  balanced: {
    label: "Standard",
    hourWidth: 12,
    labeledHourStep: 4
  },
  detail: {
    label: "Detail",
    hourWidth: 28,
    labeledHourStep: 2
  }
};

const emptyShiftTypeForm = {
  name: "",
  description: "",
  defaultLengthMinutes: 240
};

const emptyShiftForm = {
  shiftTypeId: "",
  date: "",
  startTime: "12:00",
  endTime: "",
  isPublic: false,
  capacity: 1
};

const emptyManualApplicationForm = {
  shiftId: "",
  name: "",
  email: "",
  status: "APPROVED" as ApplicationStatus,
  emailSent: false
};

function buildShiftForm(event: EventRecord | null, shiftTypes: ShiftTypeRecord[], overrides?: Partial<typeof emptyShiftForm>) {
  const shiftTypeId = overrides?.shiftTypeId ?? shiftTypes[0]?.id ?? "";
  const selectedShiftType = shiftTypes.find((shiftType) => shiftType.id === shiftTypeId) ?? null;
  const startTime = overrides?.startTime ?? emptyShiftForm.startTime;
  const endTime =
    overrides?.endTime ??
    (startTime && selectedShiftType ? addMinutesToTime(startTime, selectedShiftType.defaultLengthMinutes) : emptyShiftForm.endTime);

  return {
    ...emptyShiftForm,
    shiftTypeId,
    date: event?.startDate ?? "",
    ...overrides,
    endTime
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(payload.error ?? "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function toLocalDate(value: string) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function toDateValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatTimeMarker(hour: number) {
  return `${`${hour}`.padStart(2, "0")}:00`;
}

function replaceTemplatePlaceholders(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function buildTimelineHourLabelGroups(hourWidth: number, labeledHourStep: number) {
  const groups = [];

  for (let hour = 0; hour < 24; hour += labeledHourStep) {
    const spanHours = Math.min(labeledHourStep, 24 - hour);

    groups.push({
      hour,
      left: hour * hourWidth,
      width: spanHours * hourWidth
    });
  }

  return groups;
}

function isMajorTimelineHour(hour: number, labeledHourStep: number) {
  return hour % labeledHourStep === 0;
}

function formatApplicationStatusLabel(status: ApplicationStatus) {
  switch (status) {
    case "PENDING":
      return "Offen";
    case "APPROVED":
      return "Bestaetigt";
    case "REJECTED":
      return "Abgelehnt";
  }
}

function formatVisibilityLabel(isPublic: boolean) {
  return isPublic ? "Oeffentlich" : "Intern";
}

function minutesToLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (remainder === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainder}m`;
}

function addMinutesToTime(startTime: string, minutes: number) {
  if (!startTime || !Number.isFinite(minutes)) {
    return "";
  }

  const [hours, mins] = startTime.split(":").map(Number);

  if ([hours, mins].some((value) => Number.isNaN(value))) {
    return "";
  }

  const totalMinutes = Math.min(hours * 60 + mins + minutes, 23 * 60 + 59);
  const nextHours = Math.floor(totalMinutes / 60);
  const nextMinutes = totalMinutes % 60;
  return `${`${nextHours}`.padStart(2, "0")}:${`${nextMinutes}`.padStart(2, "0")}`;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);

  if ([hours, minutes].some((part) => Number.isNaN(part))) {
    return null;
  }

  return hours * 60 + minutes;
}

function getShiftEndAbsoluteMinutes(startTime: string, endTime: string) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  if (endMinutes === startMinutes) {
    return null;
  }

  return endMinutes > startMinutes ? endMinutes : endMinutes + 1440;
}

function addDaysToDateValue(value: string, dayCount: number) {
  const date = toLocalDate(value);

  if (!date) {
    return value;
  }

  date.setDate(date.getDate() + dayCount);
  return toDateValue(date);
}

function getShiftTimelineEndDate(date: string, startTime: string, endTime: string) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return date;
  }

  return endMinutes > startMinutes ? date : addDaysToDateValue(date, 1);
}

function enumerateDateRange(startDate: string, endDate: string) {
  const start = toLocalDate(startDate);
  const end = toLocalDate(endDate);

  if (!start || !end || start > end) {
    return [];
  }

  const days: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    days.push(toDateValue(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function buildApplicationMailtoHref(event: EventRecord | null, application: DashboardResponse["applications"][number]) {
  const subjectTemplate = event?.adminEmailSubjectTemplate ?? defaultAdminEmailSubjectTemplate;
  const bodyTemplate = event?.adminEmailBodyTemplate ?? defaultAdminEmailBodyTemplate;
  const placeholders = {
    name: application.name,
    eventName: event?.name ?? defaultFestivalName,
    shiftType: application.shiftTypeName,
    shiftDate: formatLongDate(application.shiftDate),
    shiftStartTime: application.shiftStartTime,
    shiftEndTime: application.shiftEndTime,
    visibility: formatVisibilityLabel(application.isPublic)
  };
  const subject = replaceTemplatePlaceholders(subjectTemplate, placeholders);
  const body = replaceTemplatePlaceholders(bodyTemplate, placeholders);
  return `mailto:${encodeURIComponent(application.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function AppShell({ children, action }: { children: ReactNode; action?: { label: string; to?: string; onClick?: () => void } }) {
  const actionClassName = "secondary-button topbar-button";

  return (
    <div className="shell">
      <div className="backdrop backdrop-one" />
      <div className="backdrop backdrop-two" />
      <header className="topbar simple-topbar">
        <Link className="brand" to="/">
          <span className="brand-mark">Shifty</span>
          <span className="brand-subtitle">Schichtplanung fuer Events</span>
        </Link>
        {action?.onClick ? (
          <button className={actionClassName} onClick={action.onClick} type="button">
            {action.label}
          </button>
        ) : action?.to ? (
          <Link className={actionClassName} to={action.to}>
            {action.label}
          </Link>
        ) : null}
      </header>
      <main className="content-stack">{children}</main>
    </div>
  );
}

function PrettyDateField({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  maxDate?: string;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <DatePicker
        calendarClassName="shifty-calendar"
        className="picker-input"
        dateFormat="EEE, dd MMM yyyy"
        locale={de}
        minDate={minDate ? toLocalDate(minDate) : undefined}
        maxDate={maxDate ? toLocalDate(maxDate) : undefined}
        onChange={(date: Date | null) => onChange(date instanceof Date ? toDateValue(date) : "")}
        placeholderText={placeholder ?? "Datum waehlen"}
        popperClassName="shifty-popper"
        selected={toLocalDate(value)}
        showPopperArrow={false}
      />
    </label>
  );
}

function PublicPage() {
  const [data, setData] = useState<PublicResponse | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  const [form, setForm] = useState({ name: "", email: "" });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function load() {
    setLoading(true);

    try {
      const nextData = await api<PublicResponse>("/api/public/event");
      setData(nextData);
      setMessage("");
      setSelectedShiftId((current) => {
        if (nextData.shifts.some((shift) => shift.id === current)) {
          return current;
        }

        return nextData.shifts[0]?.id ?? "";
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schichten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedShift = data?.shifts.find((shift) => shift.id === selectedShiftId) ?? null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedShift) {
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      await api("/api/public/applications", {
        method: "POST",
        body: JSON.stringify({
          shiftId: selectedShift.id,
          name: form.name,
          email: form.email
        })
      });
      setForm({ name: "", email: "" });
      setMessage("Bewerbung gesendet. Die Bestaetigungsnachricht findest du in der Dev-E-Mail-Ausgabe.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bewerbung konnte nicht gesendet werden.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell action={{ label: "Adminbereich", to: "/admin" }}>
      <section className="hero compact-hero">
        <div>
          <p className="eyebrow">Oeffentliche Anmeldung</p>
          <h1>{data?.event?.name ?? "Oeffentliche Schichten ansehen und direkt bewerben."}</h1>
          <p className="lede">Shifty zeigt hier nur Schichten, die im aktuellen Eventzeitraum ausdruecklich als oeffentlich markiert wurden.</p>
          {data?.event ? (
            <div className="plan-chip">
              {data.event.name} · {formatLongDate(data.event.startDate)} bis {formatLongDate(data.event.endDate)}
            </div>
          ) : (
            <div className="plan-chip muted">Es wurde noch kein Event eingerichtet.</div>
          )}
        </div>
      </section>

      <section className="grid-layout">
        <div className="panel">
          <div className="panel-heading">
            <h2>Sichtbare Schichten</h2>
            <span>{data?.shifts.length ?? 0} offen</span>
          </div>
          {loading ? <p className="muted">Schichten werden geladen…</p> : null}
          {!loading && data?.shifts.length === 0 ? <p className="muted">Aktuell gibt es keine oeffentlichen Schichten.</p> : null}
          <div className="shift-list">
            {data?.shifts.map((shift) => (
              <button
                key={shift.id}
                className={`shift-card ${selectedShiftId === shift.id ? "selected" : ""}`}
                onClick={() => setSelectedShiftId(shift.id)}
                type="button"
              >
                <div className="shift-card-head">
                  <strong>{shift.shiftType.name}</strong>
                  <span>{formatDate(shift.date)}</span>
                </div>
                <div className="shift-card-body">
                  <span>
                    {shift.startTime} bis {shift.endTime}
                  </span>
                  <span>{minutesToLabel(shift.durationMinutes)}</span>
                  <span>{shift.availableSpaces} freie Plaetze</span>
                </div>
                {shift.shiftType.description ? <p className="muted shift-note">{shift.shiftType.description}</p> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="panel accent-panel">
          <div className="panel-heading">
            <h2>Bewerben</h2>
            <span>{selectedShift ? selectedShift.shiftType.name : "Schicht auswaehlen"}</span>
          </div>
          {selectedShift ? (
            <>
              <div className="summary-box public-summary-box">
                <div className="summary-box-row summary-box-row-primary">
                  <strong>{selectedShift.shiftType.name}</strong>
                </div>
                <div className="summary-box-row">
                  <span className="summary-box-label">Datum</span>
                  <span>{formatLongDate(selectedShift.date)}</span>
                </div>
                <div className="summary-box-row">
                  <span className="summary-box-label">Zeit</span>
                  <span>
                    {selectedShift.startTime} bis {selectedShift.endTime} · {minutesToLabel(selectedShift.durationMinutes)}
                  </span>
                </div>
                {selectedShift.shiftType.description ? (
                  <div className="summary-box-row summary-box-row-description">
                    <span className="summary-box-label">Aufgabe</span>
                    <span>{selectedShift.shiftType.description}</span>
                  </div>
                ) : null}
                <div className="summary-box-row">
                  <span className="summary-box-label">Freie Plaetze</span>
                  <span>{selectedShift.availableSpaces}</span>
                </div>
              </div>
              <form className="stack" onSubmit={handleSubmit}>
                <label>
                  Name
                  <input
                    required
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label>
                  Email
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  />
                </label>
                <button className="primary-button" disabled={submitting || selectedShift.availableSpaces === 0} type="submit">
                  {submitting ? "Wird gesendet…" : selectedShift.availableSpaces === 0 ? "Schicht voll" : "Auf Schicht bewerben"}
                </button>
              </form>
            </>
          ) : (
            <p className="muted">Waehle eine sichtbare Schicht aus, um dich zu bewerben.</p>
          )}
          {message ? <p className="message">{message}</p> : null}
        </div>
      </section>
    </AppShell>
  );
}

function AdminLoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "admin@example.com", password: "change-me" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(form)
      });
      navigate("/admin");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell action={{ label: "Oeffentliche Schichten", to: "/" }}>
      <section className="admin-login-card panel narrow-panel">
        <p className="eyebrow">Adminzugang</p>
        <h1>Anmelden, um das Event zu verwalten.</h1>
        <p className="lede">Aktuell wird ein einzelner vordefinierter Admin-Account aus der Server-Umgebung verwendet.</p>
        <form className="stack" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </label>
          <label>
            Passwort
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Anmeldung laeuft…" : "Anmelden"}
          </button>
        </form>
        {error ? <p className="message">{error}</p> : null}
      </section>
    </AppShell>
  );
}

function AdminDashboardPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [message, setMessage] = useState("");
  const [eventForm, setEventForm] = useState({ name: defaultFestivalName, startDate: defaultFestivalStartDate, endDate: defaultFestivalEndDate });
  const [eventEditorOpen, setEventEditorOpen] = useState(false);
  const [emailTemplateDialogOpen, setEmailTemplateDialogOpen] = useState(false);
  const [emailTemplateForm, setEmailTemplateForm] = useState({
    subjectTemplate: defaultAdminEmailSubjectTemplate,
    bodyTemplate: defaultAdminEmailBodyTemplate
  });
  const [savingEmailTemplate, setSavingEmailTemplate] = useState(false);
  const [showShiftTypes, setShowShiftTypes] = useState(false);
  const [shiftTypeDialogOpen, setShiftTypeDialogOpen] = useState(false);
  const [shiftTypeForm, setShiftTypeForm] = useState(emptyShiftTypeForm);
  const [editingShiftTypeId, setEditingShiftTypeId] = useState<string | null>(null);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState(emptyShiftForm);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [shiftImportDialogOpen, setShiftImportDialogOpen] = useState(false);
  const [shiftImportFile, setShiftImportFile] = useState<File | null>(null);
  const [replaceExistingShiftImports, setReplaceExistingShiftImports] = useState(true);
  const [importingShifts, setImportingShifts] = useState(false);
  const [manualApplicationDialogOpen, setManualApplicationDialogOpen] = useState(false);
  const [manualApplicationForm, setManualApplicationForm] = useState(emptyManualApplicationForm);
  const [creatingManualApplication, setCreatingManualApplication] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState<TimelineZoomLevel>("balanced");

  async function load() {
    try {
      const nextSession = await api<SessionResponse>("/api/auth/session");
      setSession(nextSession);

      if (!nextSession.authenticated) {
        navigate("/admin/login");
        return;
      }

      const dashboard = await api<DashboardResponse>("/api/admin/dashboard");
      setData(dashboard);
      setMessage("");
      setEventForm((current) => ({
        name: dashboard.event?.name ?? current.name,
        startDate: dashboard.event?.startDate ?? current.startDate,
        endDate: dashboard.event?.endDate ?? current.endDate
      }));
      setEmailTemplateForm({
        subjectTemplate: dashboard.event?.adminEmailSubjectTemplate ?? defaultAdminEmailSubjectTemplate,
        bodyTemplate: dashboard.event?.adminEmailBodyTemplate ?? defaultAdminEmailBodyTemplate
      });
      setEventEditorOpen((current) => current || !dashboard.event);
      setShiftForm((current) => {
        if (editingShiftId) {
          return current;
        }

        const nextTypeId = dashboard.shiftTypes.some((shiftType) => shiftType.id === current.shiftTypeId)
          ? current.shiftTypeId
          : (dashboard.shiftTypes[0]?.id ?? "");
        const nextDate = current.date || dashboard.event?.startDate || "";
        const nextEndTime =
          current.endTime ||
          addMinutesToTime(current.startTime, dashboard.shiftTypes.find((shiftType) => shiftType.id === nextTypeId)?.defaultLengthMinutes ?? 0);

        return buildShiftForm(dashboard.event, dashboard.shiftTypes, {
          ...current,
          shiftTypeId: nextTypeId,
          date: nextDate,
          endTime: nextEndTime
        });
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dashboard konnte nicht geladen werden.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const currentEvent = data?.event ?? null;
  const shiftTypes = data?.shiftTypes ?? [];
  const selectedShiftType = shiftTypes.find((shiftType) => shiftType.id === shiftForm.shiftTypeId) ?? null;
  const rangeChanged = Boolean(
    currentEvent && (eventForm.startDate !== currentEvent.startDate || eventForm.endDate !== currentEvent.endDate)
  );
  const impactedShiftCount = data?.shifts.filter((shift) => shift.date < eventForm.startDate || shift.date > eventForm.endDate).length ?? 0;

  function setShiftTypeAndMaybeEndTime(nextShiftTypeId: string) {
    const nextShiftType = shiftTypes.find((shiftType) => shiftType.id === nextShiftTypeId) ?? null;

    setShiftForm((current) => ({
      ...current,
      shiftTypeId: nextShiftTypeId,
      endTime: current.startTime && nextShiftType ? addMinutesToTime(current.startTime, nextShiftType.defaultLengthMinutes) : current.endTime
    }));
  }

  function setShiftStartTime(nextStartTime: string) {
    setShiftForm((current) => ({
      ...current,
      startTime: nextStartTime,
      endTime: nextStartTime && selectedShiftType ? addMinutesToTime(nextStartTime, selectedShiftType.defaultLengthMinutes) : current.endTime
    }));
  }

  async function handleEventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (eventForm.startDate > eventForm.endDate) {
      setMessage("Das Enddatum des Events muss am oder nach dem Startdatum liegen.");
      return;
    }

    if (currentEvent && rangeChanged && impactedShiftCount > 0) {
      const confirmed = window.confirm(
        `${impactedShiftCount} Schicht${impactedShiftCount === 1 ? " liegt" : "en liegen"} ausserhalb des neuen Eventzeitraums. Sie bleiben in der Adminansicht und muessen manuell verschoben oder archiviert werden. Trotzdem fortfahren?`
      );

      if (!confirmed) {
        return;
      }
    }

    try {
      await api(currentEvent ? `/api/admin/event/${currentEvent.id}` : "/api/admin/event", {
        method: currentEvent ? "PATCH" : "POST",
        body: JSON.stringify(eventForm)
      });
      setMessage(currentEvent ? "Eventdaten wurden aktualisiert." : "Event wurde erstellt.");
      setEventEditorOpen(false);
      setShiftDialogOpen(false);
      setEditingShiftId(null);
      setShiftForm((current) => ({ ...emptyShiftForm, shiftTypeId: current.shiftTypeId, date: eventForm.startDate || current.date }));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Event konnte nicht gespeichert werden.");
    }
  }

  async function handleShiftTypeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentEvent) {
      setMessage("Erstelle zuerst das Event.");
      return;
    }

    try {
      await api(editingShiftTypeId ? `/api/admin/shift-types/${editingShiftTypeId}` : "/api/admin/shift-types", {
        method: editingShiftTypeId ? "PATCH" : "POST",
        body: JSON.stringify({
          eventId: currentEvent.id,
          name: shiftTypeForm.name,
          description: shiftTypeForm.description,
          defaultLengthMinutes: Number(shiftTypeForm.defaultLengthMinutes)
        })
      });
      setMessage(editingShiftTypeId ? "Schichttyp wurde aktualisiert." : "Schichttyp wurde erstellt.");
      setEditingShiftTypeId(null);
      setShiftTypeForm(emptyShiftTypeForm);
      setShiftTypeDialogOpen(false);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schichttyp konnte nicht gespeichert werden.");
    }
  }

  function openNewShiftTypeDialog() {
    setEditingShiftTypeId(null);
    setShiftTypeForm(emptyShiftTypeForm);
    setShiftTypeDialogOpen(true);
  }

  function openEditShiftTypeDialog(shiftType: ShiftTypeRecord) {
    setEditingShiftTypeId(shiftType.id);
    setShiftTypeForm({
      name: shiftType.name,
      description: shiftType.description,
      defaultLengthMinutes: shiftType.defaultLengthMinutes
    });
    setShiftTypeDialogOpen(true);
  }

  function closeShiftTypeDialog() {
    setShiftTypeDialogOpen(false);
    setEditingShiftTypeId(null);
    setShiftTypeForm(emptyShiftTypeForm);
  }

  function openNewShiftDialog() {
    setEditingShiftId(null);
    setShiftForm(buildShiftForm(currentEvent, shiftTypes));
    setShiftDialogOpen(true);
  }

  function closeShiftDialog() {
    setShiftDialogOpen(false);
    setEditingShiftId(null);
    setShiftForm(buildShiftForm(currentEvent, shiftTypes));
  }

  function openShiftImportDialog() {
    setShiftImportFile(null);
    setReplaceExistingShiftImports(true);
    setShiftImportDialogOpen(true);
  }

  function closeShiftImportDialog() {
    setShiftImportDialogOpen(false);
    setShiftImportFile(null);
    setReplaceExistingShiftImports(true);
  }

  function openEmailTemplateDialog() {
    setEmailTemplateForm({
      subjectTemplate: currentEvent?.adminEmailSubjectTemplate ?? defaultAdminEmailSubjectTemplate,
      bodyTemplate: currentEvent?.adminEmailBodyTemplate ?? defaultAdminEmailBodyTemplate
    });
    setEmailTemplateDialogOpen(true);
  }

  function closeEmailTemplateDialog() {
    setEmailTemplateDialogOpen(false);
    setEmailTemplateForm({
      subjectTemplate: currentEvent?.adminEmailSubjectTemplate ?? defaultAdminEmailSubjectTemplate,
      bodyTemplate: currentEvent?.adminEmailBodyTemplate ?? defaultAdminEmailBodyTemplate
    });
  }

  function openManualApplicationDialog() {
    const defaultShiftId = data?.shifts.find((shift) => !shift.archived)?.id ?? "";
    setManualApplicationForm({
      ...emptyManualApplicationForm,
      shiftId: defaultShiftId
    });
    setManualApplicationDialogOpen(true);
  }

  function closeManualApplicationDialog() {
    setManualApplicationDialogOpen(false);
    setManualApplicationForm(emptyManualApplicationForm);
  }

  async function handleShiftTypeDelete(shiftType: ShiftTypeRecord) {
    if (shiftType.shiftCount > 0) {
      setMessage("Schichttypen, die bereits verwendet werden, koennen nicht geloescht werden.");
      return;
    }

    const confirmed = window.confirm(`Schichttyp \"${shiftType.name}\" wirklich loeschen?`);

    if (!confirmed) {
      return;
    }

    try {
      await api(`/api/admin/shift-types/${shiftType.id}`, { method: "DELETE" });
      setMessage("Schichttyp wurde geloescht.");

      if (editingShiftTypeId === shiftType.id) {
        closeShiftTypeDialog();
      }

      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schichttyp konnte nicht geloescht werden.");
    }
  }

  async function handleShiftSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentEvent) {
      setMessage("Erstelle zuerst das Event.");
      return;
    }

    if (!shiftForm.shiftTypeId) {
      setMessage("Lege mindestens einen Schichttyp an, bevor du Schichten hinzufuegst.");
      return;
    }

    const payload = {
      eventId: currentEvent.id,
      shiftTypeId: shiftForm.shiftTypeId,
      date: shiftForm.date,
      startTime: shiftForm.startTime,
      endTime: shiftForm.endTime,
      isPublic: shiftForm.isPublic,
      capacity: Number(shiftForm.capacity)
    };

    try {
      await api(editingShiftId ? `/api/admin/shifts/${editingShiftId}` : "/api/admin/shifts", {
        method: editingShiftId ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      });
      setMessage(editingShiftId ? "Schicht wurde aktualisiert." : "Schicht wurde erstellt.");
      setShiftForm(buildShiftForm(currentEvent, shiftTypes, { shiftTypeId: shiftForm.shiftTypeId }));
      setEditingShiftId(null);
      setShiftDialogOpen(false);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schicht konnte nicht gespeichert werden.");
    }
  }

  async function handleShiftImportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentEvent) {
      setMessage("Erstelle zuerst das Event.");
      return;
    }

    if (!shiftImportFile) {
      setMessage("Waehle zuerst eine CSV-Datei aus.");
      return;
    }

    setImportingShifts(true);

    try {
      const csvText = await shiftImportFile.text();
      const result = await api<ShiftImportResponse>("/api/admin/shifts/import", {
        method: "POST",
        body: JSON.stringify({
          eventId: currentEvent.id,
          csvText,
          replaceExisting: replaceExistingShiftImports
        })
      });

      setMessage(
        `${result.importedShiftCount} Schichten aus CSV importiert. ${result.upsertedShiftTypeCount} Schichttypen wurden aktualisiert.${result.replaceExisting ? " Bestehende Schichten und Bewerbungen wurden ersetzt." : ""}`
      );
      closeShiftImportDialog();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CSV konnte nicht importiert werden.");
    } finally {
      setImportingShifts(false);
    }
  }

  async function handleEmailTemplateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentEvent) {
      setMessage("Erstelle zuerst das Event.");
      return;
    }

    setSavingEmailTemplate(true);

    try {
      await api(`/api/admin/event/${currentEvent.id}/email-template`, {
        method: "PATCH",
        body: JSON.stringify(emailTemplateForm)
      });
      setMessage("E-Mail-Vorlage wurde gespeichert.");
      setEmailTemplateDialogOpen(false);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "E-Mail-Vorlage konnte nicht gespeichert werden.");
    } finally {
      setSavingEmailTemplate(false);
    }
  }

  async function handleManualApplicationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentEvent) {
      setMessage("Erstelle zuerst das Event.");
      return;
    }

    setCreatingManualApplication(true);

    try {
      await api("/api/admin/applications/manual", {
        method: "POST",
        body: JSON.stringify({
          eventId: currentEvent.id,
          ...manualApplicationForm
        })
      });
      setMessage("Person wurde der Schicht hinzugefuegt.");
      closeManualApplicationDialog();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Person konnte nicht hinzugefuegt werden.");
    } finally {
      setCreatingManualApplication(false);
    }
  }

  async function handleArchiveToggle(shiftId: string, archived: boolean) {
    try {
      await api(`/api/admin/shifts/${shiftId}/${archived ? "unarchive" : "archive"}`, { method: "POST" });
      setMessage(archived ? "Schicht wurde wieder aktiviert." : "Schicht wurde archiviert.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schicht konnte nicht aktualisiert werden.");
    }
  }

  async function updateApplicationStatus(applicationId: string, status: ApplicationStatus) {
    try {
      await api(`/api/admin/applications/${applicationId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setMessage(`Bewerbung wurde auf ${formatApplicationStatusLabel(status)} gesetzt.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bewerbung konnte nicht aktualisiert werden.");
    }
  }

  async function updateApplicationEmailSent(applicationId: string, emailSent: boolean) {
    try {
      await api(`/api/admin/applications/${applicationId}/email-sent`, {
        method: "PATCH",
        body: JSON.stringify({ emailSent })
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mail-Status konnte nicht aktualisiert werden.");
    }
  }

  async function handleLogout() {
    await api("/api/auth/logout", { method: "POST" });
    navigate("/");
  }

  function startEditingShift(shift: Shift) {
    setEditingShiftId(shift.id);
    setShiftForm({
      shiftTypeId: shift.shiftType.id,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      isPublic: shift.isPublic,
      capacity: shift.capacity
    });
    setShiftDialogOpen(true);
  }

  if (session && !session.authenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  const visibleShifts = data?.shifts.filter((shift) => (showArchived ? true : !shift.archived)) ?? [];
  const timelineZoomConfig = timelineZoomOptions[timelineZoom];
  const timelineHourWidth = timelineZoomConfig.hourWidth;
  const timelineDayWidth = timelineHourWidth * 24;
  const timelineLabelWidth = 232;
  const timelineBarHeight = 46;
  const timelineLaneGap = 8;
  const timelineRangeStart = currentEvent ? [currentEvent.startDate, ...visibleShifts.map((shift) => shift.date)].sort()[0] : "";
  const timelineRangeEnd = currentEvent
    ? [currentEvent.endDate, ...visibleShifts.map((shift) => getShiftTimelineEndDate(shift.date, shift.startTime, shift.endTime))].sort().at(-1) ?? currentEvent.endDate
    : "";
  const timelineDays = currentEvent ? enumerateDateRange(timelineRangeStart, timelineRangeEnd) : [];
  const timelineHours = Array.from({ length: 24 }, (_, hour) => hour);
  const timelineHourLabelGroups = buildTimelineHourLabelGroups(timelineHourWidth, timelineZoomConfig.labeledHourStep);
  const timelineDayIndex = new Map(timelineDays.map((day, index) => [day, index]));
  const timelineRows = shiftTypes
    .map((shiftType) => {
      const shiftsForType = visibleShifts
        .filter((shift) => shift.shiftType.id === shiftType.id)
        .sort((left, right) => {
          const leftKey = `${left.date}-${left.startTime}-${left.endTime}`;
          const rightKey = `${right.date}-${right.startTime}-${right.endTime}`;
          return leftKey.localeCompare(rightKey);
        });
      const laneEnds: number[] = [];

      const bars = shiftsForType.map((shift) => {
        const dayIndex = timelineDayIndex.get(shift.date) ?? 0;
        const startMinutes = timeToMinutes(shift.startTime) ?? 0;
        const endMinutes = Math.max(getShiftEndAbsoluteMinutes(shift.startTime, shift.endTime) ?? startMinutes + 30, startMinutes + 30);
        const absoluteStart = dayIndex * 1440 + startMinutes;
        const absoluteEnd = dayIndex * 1440 + endMinutes;
        let laneIndex = laneEnds.findIndex((laneEnd) => absoluteStart >= laneEnd);

        if (laneIndex === -1) {
          laneIndex = laneEnds.length;
          laneEnds.push(absoluteEnd);
        } else {
          laneEnds[laneIndex] = absoluteEnd;
        }

        return {
          shift,
          laneIndex,
          left: dayIndex * timelineDayWidth + (startMinutes / 1440) * timelineDayWidth,
          width: Math.max(((endMinutes - startMinutes) / 1440) * timelineDayWidth, 40)
        };
      });

      const laneCount = bars.length ? Math.max(...bars.map((bar) => bar.laneIndex)) + 1 : 1;

      return {
        shiftType,
        shifts: shiftsForType,
        bars,
        rowHeight: laneCount * timelineBarHeight + Math.max(0, laneCount - 1) * timelineLaneGap + 16
      };
    })
    .filter((row) => row.shifts.length > 0);
  const timelineWidth = timelineDays.length * timelineDayWidth;

  return (
    <AppShell action={{ label: "Abmelden", onClick: () => void handleLogout() }}>
      {message ? <p className="message surface-message">{message}</p> : null}

      {!currentEvent ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>Event anlegen</h2>
            <span>Aktuell ein Event</span>
          </div>
          <p className="lede compact-copy">Lege zuerst den Eventzeitraum fest. Schichttypen und Schichten koennen erst danach hinzugefuegt werden.</p>
          <form className="stack" onSubmit={handleEventSubmit}>
            <label>
              Eventname
              <input
                required
                value={eventForm.name}
                onChange={(event) => setEventForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <div className="form-row">
              <PrettyDateField label="Startdatum" onChange={(value) => setEventForm((current) => ({ ...current, startDate: value }))} value={eventForm.startDate} />
              <PrettyDateField label="Enddatum" minDate={eventForm.startDate} onChange={(value) => setEventForm((current) => ({ ...current, endDate: value }))} value={eventForm.endDate} />
            </div>
            <button className="primary-button" type="submit">Event erstellen</button>
          </form>
        </section>
      ) : (
        <>
          <section className="panel">
              <div className="panel-heading">
                <h2>Event</h2>
                <div className="button-row compact-row event-actions-row">
                  <button className="secondary-button" onClick={() => setShowShiftTypes((current) => !current)} type="button">
                    {showShiftTypes ? "Schichttypen ausblenden" : "Schichttypen anzeigen"}
                  </button>
                  <button className="secondary-button" onClick={openEmailTemplateDialog} type="button">
                    E-Mail-Vorlage
                  </button>
                  <button className="secondary-button" onClick={() => setEventEditorOpen((current) => !current)} type="button">
                    {eventEditorOpen ? "Datumseditor ausblenden" : "Eventdaten bearbeiten"}
                  </button>
                </div>
              </div>
              <div className="event-overview">
                <div>
                  <span className="meta-label">Name</span>
                  <strong>{currentEvent.name}</strong>
                </div>
                <div>
                  <span className="meta-label">Beginn</span>
                  <strong>{formatLongDate(currentEvent.startDate)}</strong>
                </div>
                <div>
                  <span className="meta-label">Ende</span>
                  <strong>{formatLongDate(currentEvent.endDate)}</strong>
                </div>
              </div>
              {currentEvent.outOfRangeShiftCount ? (
                <div className="warning-box">
                  Achtung: {currentEvent.outOfRangeShiftCount} bestehende Schicht{currentEvent.outOfRangeShiftCount === 1 ? " liegt" : "en liegen"} ausserhalb des aktuellen Eventzeitraums.
                </div>
              ) : null}
              {eventEditorOpen ? (
                <form className="stack top-gap" onSubmit={handleEventSubmit}>
                  <label>
                    Eventname
                    <input
                      required
                      value={eventForm.name}
                      onChange={(event) => setEventForm((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>
                  <div className="form-row">
                    <PrettyDateField label="Startdatum" onChange={(value) => setEventForm((current) => ({ ...current, startDate: value }))} value={eventForm.startDate} />
                    <PrettyDateField label="Enddatum" minDate={eventForm.startDate} onChange={(value) => setEventForm((current) => ({ ...current, endDate: value }))} value={eventForm.endDate} />
                  </div>
                  {rangeChanged && impactedShiftCount > 0 ? (
                    <div className="warning-box">
                      Achtung: {impactedShiftCount} Schicht{impactedShiftCount === 1 ? " faellt" : "en fallen"} ausserhalb des neu gewaehlten Zeitraums.
                    </div>
                  ) : null}
                  <div className="button-row compact-row">
                    <button className="primary-button" type="submit">Eventdaten speichern</button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setEventEditorOpen(false);
                        setEventForm({ name: currentEvent.name, startDate: currentEvent.startDate, endDate: currentEvent.endDate });
                      }}
                      type="button"
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              ) : null}
              {showShiftTypes ? (
                <div className="shift-types-panel top-gap">
                  <div className="panel-heading shift-types-heading">
                    <div>
                      <h3>Schichttypen</h3>
                      <p className="muted shift-types-copy">Wiederverwendbare Vorlagen fuer Rollen, Zeitvorgaben und Beschreibungen.</p>
                    </div>
                    <div className="button-row compact-row shift-types-header-actions">
                      <span className="meta-badge">{shiftTypes.length} gespeichert</span>
                      <button className="primary-button" onClick={openNewShiftTypeDialog} type="button">
                        Schichttyp hinzufuegen
                      </button>
                    </div>
                  </div>
                  <div className="shift-type-list">
                    {shiftTypes.map((shiftType) => (
                      <article className="shift-type-card" key={shiftType.id}>
                        <div className="shift-type-card-main">
                          <div className="shift-type-card-head">
                            <strong>{shiftType.name}</strong>
                            <div className="shift-type-meta-row">
                              <span className="meta-badge">{minutesToLabel(shiftType.defaultLengthMinutes)} Standard</span>
                              <span className="meta-badge">{shiftType.shiftCount} zugewiesene Schicht{shiftType.shiftCount === 1 ? "" : "en"}</span>
                            </div>
                          </div>
                          {shiftType.description ? <p className="shift-type-description">{shiftType.description}</p> : null}
                        </div>
                        <div className="button-row compact-row shift-type-actions">
                          <button className="secondary-button" onClick={() => openEditShiftTypeDialog(shiftType)} type="button">
                            Bearbeiten
                          </button>
                          <button
                            className={`secondary-button ${shiftType.shiftCount > 0 ? "" : "danger-button"}`}
                            disabled={shiftType.shiftCount > 0}
                            onClick={() => void handleShiftTypeDelete(shiftType)}
                            type="button"
                          >
                            Loeschen
                          </button>
                        </div>
                      </article>
                    ))}
                    {!shiftTypes.length ? <p className="muted">Es gibt noch keine Schichttypen. Fuege zuerst einen hinzu.</p> : null}
                  </div>
                </div>
              ) : null}
          </section>

          {shiftTypeDialogOpen ? (
            <dialog aria-modal="true" className="modal-dialog" open>
              <div className="modal-backdrop" onClick={closeShiftTypeDialog} />
              <div className="modal-card">
                <div className="panel-heading modal-heading">
                  <div>
                    <h2>{editingShiftTypeId ? "Schichttyp bearbeiten" : "Neuer Schichttyp"}</h2>
                    <p className="muted shift-types-copy">Lege Namen, Beschreibung und Standarddauer fest, damit neue Schichten passend vorausgefuellt werden.</p>
                  </div>
                </div>
                <form className="stack" onSubmit={handleShiftTypeSubmit}>
                  <label>
                    Name
                    <input
                      autoFocus
                      value={shiftTypeForm.name}
                      onChange={(event) => setShiftTypeForm((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>
                  <label>
                    Beschreibung
                    <textarea
                      rows={4}
                      value={shiftTypeForm.description}
                      onChange={(event) => setShiftTypeForm((current) => ({ ...current, description: event.target.value }))}
                    />
                  </label>
                  <label>
                    Standarddauer in Minuten
                    <input
                      min={15}
                      step={15}
                      type="number"
                      value={shiftTypeForm.defaultLengthMinutes}
                      onChange={(event) => setShiftTypeForm((current) => ({ ...current, defaultLengthMinutes: Number(event.target.value) }))}
                    />
                  </label>
                  <div className="button-row compact-row">
                    <button className="primary-button" type="submit">
                      {editingShiftTypeId ? "Schichttyp speichern" : "Schichttyp anlegen"}
                    </button>
                    <button className="secondary-button" onClick={closeShiftTypeDialog} type="button">
                      Abbrechen
                    </button>
                  </div>
                </form>
              </div>
            </dialog>
          ) : null}

          {emailTemplateDialogOpen ? (
            <dialog aria-modal="true" className="modal-dialog" open>
              <div className="modal-backdrop" onClick={closeEmailTemplateDialog} />
              <div className="modal-card shift-editor-modal">
                <div className="panel-heading modal-heading">
                  <div>
                    <h2>E-Mail-Vorlage</h2>
                    <p className="muted shift-types-copy">Platzhalter: {'{name}'}, {'{eventName}'}, {'{shiftType}'}, {'{shiftDate}'}, {'{shiftStartTime}'}, {'{shiftEndTime}'}, {'{visibility}'}</p>
                  </div>
                </div>
                <form className="stack" onSubmit={handleEmailTemplateSubmit}>
                  <label>
                    Betreff
                    <input
                      autoFocus
                      value={emailTemplateForm.subjectTemplate}
                      onChange={(event) => setEmailTemplateForm((current) => ({ ...current, subjectTemplate: event.target.value }))}
                    />
                  </label>
                  <label>
                    Nachricht
                    <textarea
                      rows={8}
                      value={emailTemplateForm.bodyTemplate}
                      onChange={(event) => setEmailTemplateForm((current) => ({ ...current, bodyTemplate: event.target.value }))}
                    />
                  </label>
                  <div className="button-row compact-row">
                    <button className="primary-button" disabled={savingEmailTemplate} type="submit">
                      {savingEmailTemplate ? "Wird gespeichert..." : "Vorlage speichern"}
                    </button>
                    <button className="secondary-button" onClick={closeEmailTemplateDialog} type="button">
                      Abbrechen
                    </button>
                  </div>
                </form>
              </div>
            </dialog>
          ) : null}

          {shiftDialogOpen ? (
            <dialog aria-modal="true" className="modal-dialog" open>
              <div className="modal-backdrop" onClick={closeShiftDialog} />
              <div className="modal-card shift-editor-modal">
                <div className="panel-heading modal-heading">
                  <div>
                    <h2>{editingShiftId ? "Schicht bearbeiten" : "Neue Schicht"}</h2>
                    <p className="muted shift-types-copy">{shiftTypes.length ? "Lege Schichttyp, Datum, Uhrzeit, Sichtbarkeit und Kapazitaet fest." : "Lege zuerst einen Schichttyp an, bevor du Schichten planst."}</p>
                  </div>
                </div>
                <form className="stack" onSubmit={handleShiftSubmit}>
                  <label>
                    Schichttyp
                    <select value={shiftForm.shiftTypeId} onChange={(event) => setShiftTypeAndMaybeEndTime(event.target.value)}>
                      <option value="">Schichttyp waehlen</option>
                      {shiftTypes.map((shiftType) => (
                        <option key={shiftType.id} value={shiftType.id}>
                          {shiftType.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedShiftType?.description ? <p className="muted">{selectedShiftType.description}</p> : null}
                  <PrettyDateField
                    label="Datum"
                    maxDate={currentEvent.endDate}
                    minDate={currentEvent.startDate}
                    onChange={(value) => setShiftForm((current) => ({ ...current, date: value }))}
                    value={shiftForm.date || currentEvent.startDate}
                  />
                  <div className="form-row">
                    <label>
                      Beginn
                      <input type="time" value={shiftForm.startTime} onChange={(event) => setShiftStartTime(event.target.value)} />
                    </label>
                    <label>
                      Ende
                      <input
                        type="time"
                        value={shiftForm.endTime}
                        onChange={(event) => setShiftForm((current) => ({ ...current, endTime: event.target.value }))}
                      />
                    </label>
                  </div>
                  {selectedShiftType && shiftForm.startTime ? (
                    <p className="muted">Die vorgeschlagene Endzeit basiert auf {selectedShiftType.name} mit {minutesToLabel(selectedShiftType.defaultLengthMinutes)} Standarddauer.</p>
                  ) : null}
                  <div className="form-row">
                    <label>
                      Sichtbarkeit
                      <select
                        value={shiftForm.isPublic ? "public" : "internal"}
                        onChange={(event) => setShiftForm((current) => ({ ...current, isPublic: event.target.value === "public" }))}
                      >
                        <option value="internal">Nur intern</option>
                        <option value="public">Oeffentlich</option>
                      </select>
                    </label>
                    <label>
                      Plaetze
                      <input
                        min={1}
                        type="number"
                        value={shiftForm.capacity}
                        onChange={(event) => setShiftForm((current) => ({ ...current, capacity: Number(event.target.value) }))}
                      />
                    </label>
                  </div>
                  <div className="button-row compact-row">
                    <button className="primary-button" disabled={!shiftTypes.length} type="submit">
                      {editingShiftId ? "Schicht speichern" : "Schicht anlegen"}
                    </button>
                    <button className="secondary-button" onClick={closeShiftDialog} type="button">
                      Abbrechen
                    </button>
                  </div>
                </form>
              </div>
            </dialog>
          ) : null}

          {shiftImportDialogOpen ? (
            <dialog aria-modal="true" className="modal-dialog" open>
              <div className="modal-backdrop" onClick={closeShiftImportDialog} />
              <div className="modal-card">
                <div className="panel-heading modal-heading">
                  <div>
                    <h2>Schichten aus CSV importieren</h2>
                    <p className="muted shift-types-copy">Lade eine CSV-Datei hoch, um Schichten und benoetigte Schichttypen gesammelt anzulegen.</p>
                  </div>
                </div>
                <form className="stack" onSubmit={handleShiftImportSubmit}>
                  <label>
                    CSV-Datei
                    <input
                      accept=".csv,text/csv"
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setShiftImportFile(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                  </label>
                  {shiftImportFile ? <p className="muted field-help">Ausgewaehlt: {shiftImportFile.name}</p> : null}
                  <div className="import-format-box">
                    <strong>Erwartete Spalten</strong>
                    <p>shiftTypeName, shiftTypeDescription, defaultLengthMinutes, date, startTime, endTime, capacity, isPublic</p>
                    <div className="button-row compact-row import-link-row">
                      <a className="secondary-button" download href="/current-shifts.csv">
                        Aktuelle CSV herunterladen
                      </a>
                    </div>
                  </div>
                  <label className="toggle-inline import-toggle">
                    <input
                      checked={replaceExistingShiftImports}
                      onChange={(event) => setReplaceExistingShiftImports(event.target.checked)}
                      type="checkbox"
                    />
                    Bestehende Schichten und Bewerbungen vor dem Import ersetzen
                  </label>
                  <div className="button-row compact-row">
                    <button className="primary-button" disabled={importingShifts} type="submit">
                      {importingShifts ? "CSV wird importiert..." : "CSV importieren"}
                    </button>
                    <button className="secondary-button" onClick={closeShiftImportDialog} type="button">
                      Abbrechen
                    </button>
                  </div>
                </form>
              </div>
            </dialog>
          ) : null}

          {manualApplicationDialogOpen ? (
            <dialog aria-modal="true" className="modal-dialog" open>
              <div className="modal-backdrop" onClick={closeManualApplicationDialog} />
              <div className="modal-card">
                <div className="panel-heading modal-heading">
                  <div>
                    <h2>Person manuell zuweisen</h2>
                    <p className="muted shift-types-copy">Fuege eine Person direkt zu einer Schicht hinzu, auch ohne die oeffentliche Bewerbung zu nutzen.</p>
                  </div>
                </div>
                <form className="stack" onSubmit={handleManualApplicationSubmit}>
                  <label>
                    Schicht
                    <select
                      value={manualApplicationForm.shiftId}
                      onChange={(event) => setManualApplicationForm((current) => ({ ...current, shiftId: event.target.value }))}
                    >
                      <option value="">Schicht waehlen</option>
                      {data?.shifts.filter((shift) => !shift.archived).map((shift) => (
                        <option key={shift.id} value={shift.id}>
                          {shift.shiftType.name} · {formatDate(shift.date)} · {shift.startTime} bis {shift.endTime}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-row">
                    <label>
                      Name
                      <input
                        value={manualApplicationForm.name}
                        onChange={(event) => setManualApplicationForm((current) => ({ ...current, name: event.target.value }))}
                      />
                    </label>
                    <label>
                      E-Mail
                      <input
                        type="email"
                        value={manualApplicationForm.email}
                        onChange={(event) => setManualApplicationForm((current) => ({ ...current, email: event.target.value }))}
                      />
                    </label>
                  </div>
                  <div className="form-row">
                    <label>
                      Status
                      <select
                        value={manualApplicationForm.status}
                        onChange={(event) => setManualApplicationForm((current) => ({ ...current, status: event.target.value as ApplicationStatus }))}
                      >
                        <option value="PENDING">Offen</option>
                        <option value="APPROVED">Bestaetigt</option>
                        <option value="REJECTED">Abgelehnt</option>
                      </select>
                    </label>
                    <label className="toggle-inline manual-checkbox">
                      <input
                        checked={manualApplicationForm.emailSent}
                        onChange={(event) => setManualApplicationForm((current) => ({ ...current, emailSent: event.target.checked }))}
                        type="checkbox"
                      />
                      E-Mail bereits gesendet
                    </label>
                  </div>
                  <div className="button-row compact-row">
                    <button className="primary-button" disabled={creatingManualApplication} type="submit">
                      {creatingManualApplication ? "Wird hinzugefuegt..." : "Person hinzufuegen"}
                    </button>
                    <button className="secondary-button" onClick={closeManualApplicationDialog} type="button">
                      Abbrechen
                    </button>
                  </div>
                </form>
              </div>
            </dialog>
          ) : null}
        </>
      )}

      {currentEvent ? (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>Schichten</h2>
              <div className="button-row compact-row shift-section-actions">
                <label className="toggle-inline">
                  <input checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} type="checkbox" />
                  Archivierte anzeigen
                </label>
                <a className="secondary-button" download href="/current-shifts.csv">
                  Aktuelle CSV
                </a>
                <button className="secondary-button" onClick={openShiftImportDialog} type="button">
                  CSV importieren
                </button>
                <button className="primary-button" disabled={!shiftTypes.length} onClick={openNewShiftDialog} type="button">
                  Schicht hinzufuegen
                </button>
              </div>
            </div>
            {timelineRows.length ? (
              <div className="shift-timeline">
                <div className="panel-heading shift-timeline-heading">
                  <div>
                    <h3>Schichtplan</h3>
                    <p className="muted shift-types-copy">Jede Zeile steht fuer einen Schichttyp. Die Balken zeigen Tag und Uhrzeit, ein Klick oeffnet die Schicht im Editor.</p>
                  </div>
                  <div className="shift-timeline-toolbar">
                    <div className="button-row compact-row shift-types-header-actions">
                      <span className="meta-badge">{timelineDays.length} Tag{timelineDays.length === 1 ? "" : "e"}</span>
                      <span className="meta-badge">{visibleShifts.length} Schicht{visibleShifts.length === 1 ? "" : "en"} sichtbar</span>
                    </div>
                    <div aria-label="Zoom fuer Stundenraster" className="zoom-toggle" role="group">
                      <span className="zoom-toggle-label">Zoom</span>
                      {timelineZoomOrder.map((zoomLevel) => (
                        <button
                          aria-pressed={timelineZoom === zoomLevel}
                          className={`zoom-toggle-button ${timelineZoom === zoomLevel ? "is-active" : ""}`}
                          key={zoomLevel}
                          onClick={() => setTimelineZoom(zoomLevel)}
                          type="button"
                        >
                          {timelineZoomOptions[zoomLevel].label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="shift-timeline-shell">
                  <div className="shift-timeline-labels" style={{ width: timelineLabelWidth }}>
                    <div className="shift-timeline-corner">Schichttyp</div>
                    {timelineRows.map((row) => (
                      <div className="shift-timeline-label" key={row.shiftType.id} style={{ height: row.rowHeight }}>
                        <strong>{row.shiftType.name}</strong>
                        <span className="muted">{row.shifts.length} Schicht{row.shifts.length === 1 ? "" : "en"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="shift-timeline-scroll">
                    <div className="shift-timeline-track" style={{ width: timelineWidth }}>
                      <div className="shift-timeline-header" style={{ width: timelineWidth }}>
                        {timelineDays.map((day) => (
                          <div
                            className={`shift-timeline-day-header ${day < currentEvent.startDate || day > currentEvent.endDate ? "out-of-range" : ""}`}
                            key={day}
                            style={{ width: timelineDayWidth }}
                          >
                            <div className="shift-timeline-day-label">
                              <strong>{formatDate(day)}</strong>
                            </div>
                            <div className="shift-timeline-hour-header">
                              {timelineHours.map((hour) => (
                                <span
                                  className={`shift-timeline-hour-slot ${isMajorTimelineHour(hour, timelineZoomConfig.labeledHourStep) ? "is-major" : ""}`}
                                  key={`${day}-${hour}`}
                                  style={{ width: timelineHourWidth }}
                                />
                              ))}
                              <div className="shift-timeline-hour-labels">
                                {timelineHourLabelGroups.map((group) => (
                                  <span
                                    className="shift-timeline-hour-label-group"
                                    key={`${day}-${group.hour}`}
                                    style={{ left: group.left, width: group.width }}
                                  >
                                    {formatTimeMarker(group.hour)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {timelineRows.map((row) => (
                        <div className="shift-timeline-row" key={row.shiftType.id} style={{ width: timelineWidth, height: row.rowHeight }}>
                          {timelineDays.map((day, index) => (
                            <div
                              className={`shift-timeline-day-column ${day < currentEvent.startDate || day > currentEvent.endDate ? "out-of-range" : ""}`}
                              key={`${row.shiftType.id}-${day}`}
                              style={{ left: index * timelineDayWidth, width: timelineDayWidth }}
                            >
                              {timelineHours.map((hour) => (
                                <span
                                  className={`shift-timeline-hour-column ${isMajorTimelineHour(hour, timelineZoomConfig.labeledHourStep) ? "is-major" : ""}`}
                                  key={`${row.shiftType.id}-${day}-${hour}`}
                                  style={{ width: timelineHourWidth }}
                                />
                              ))}
                            </div>
                          ))}
                          {row.bars.map((bar) => (
                            <button
                              aria-label={`${bar.shift.shiftType.name} am ${bar.shift.date} von ${bar.shift.startTime} bis ${bar.shift.endTime} bearbeiten`}
                              className={`shift-timeline-bar ${bar.shift.isPublic ? "is-public" : "is-internal"} ${bar.shift.archived ? "is-archived" : ""} ${!bar.shift.insideEventRange ? "is-out-of-range" : ""}`}
                              key={bar.shift.id}
                              onClick={() => startEditingShift(bar.shift)}
                              style={{
                                left: `${bar.left}px`,
                                top: `${8 + bar.laneIndex * (timelineBarHeight + timelineLaneGap)}px`,
                                width: `${bar.width}px`,
                                height: `${timelineBarHeight}px`
                              }}
                              title={`${bar.shift.shiftType.name} · ${formatLongDate(bar.shift.date)} · ${bar.shift.startTime} bis ${bar.shift.endTime}`}
                              type="button"
                            >
                              <span className="shift-timeline-bar-title">{bar.shift.reservedCount}/{bar.shift.capacity} Personen</span>
                              <span className="shift-timeline-bar-meta">{bar.shift.shiftType.name} · {formatVisibilityLabel(bar.shift.isPublic)}</span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="muted">Es gibt noch keine Schichten fuer die Zeitleiste.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h2>Bewerbungen</h2>
              <div className="button-row compact-row shift-section-actions">
                <span>{data?.applications.length ?? 0} Eintraege</span>
                <button className="secondary-button" onClick={openManualApplicationDialog} type="button">
                  Person zuweisen
                </button>
              </div>
            </div>
            <div className="application-table-wrap">
              <table className="application-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>E-Mail</th>
                    <th>Schicht</th>
                    <th>Kontakt</th>
                    <th>Gesendet</th>
                    <th>Status</th>
                    <th>Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.applications.map((application) => (
                    <tr key={application.id}>
                      <td>{application.name}</td>
                      <td>{application.email}</td>
                      <td>
                        {application.shiftTypeName}
                        <div className="table-subtle">
                          {formatDate(application.shiftDate)} · {application.shiftStartTime} bis {application.shiftEndTime} · {formatVisibilityLabel(application.isPublic)}
                        </div>
                      </td>
                      <td>
                        <a className="secondary-button table-mail-button" href={buildApplicationMailtoHref(currentEvent, application)}>
                          E-Mail senden
                        </a>
                      </td>
                      <td>
                        <label className="table-checkbox">
                          <input
                            checked={application.emailSent}
                            onChange={(event) => void updateApplicationEmailSent(application.id, event.target.checked)}
                            type="checkbox"
                          />
                          <span>{application.emailSent ? "Ja" : "Nein"}</span>
                        </label>
                      </td>
                      <td>
                        <span className={`status-pill status-${application.status.toLowerCase()}`}>{formatApplicationStatusLabel(application.status)}</span>
                      </td>
                      <td>
                        <div className="button-row compact-row">
                          <button className="secondary-button" onClick={() => void updateApplicationStatus(application.id, "PENDING")} type="button">
                            Offen
                          </button>
                          <button className="secondary-button" onClick={() => void updateApplicationStatus(application.id, "APPROVED")} type="button">
                            Bestaetigen
                          </button>
                          <button className="secondary-button danger-button" onClick={() => void updateApplicationStatus(application.id, "REJECTED")} type="button">
                            Ablehnen
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data?.applications.length ? <p className="muted">Es gibt noch keine Bewerbungen.</p> : null}
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicPage />} path="/" />
      <Route element={<AdminLoginPage />} path="/admin/login" />
      <Route element={<AdminDashboardPage />} path="/admin" />
    </Routes>
  );
}