import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type Language = 'de' | 'en';

const translations = {
  // Navigation
  'nav.dashboard': { de: 'Dashboard', en: 'Dashboard' },
  'nav.tenders': { de: 'Ausschreibungen', en: 'Tenders' },
  'nav.newTender': { de: 'Neue Ausschreibung', en: 'New Tender' },
  'nav.memory': { de: 'Firmenwissen', en: 'Company Memory' },
  'nav.settings': { de: 'Einstellungen', en: 'Settings' },
  'nav.logout': { de: 'Abmelden', en: 'Log out' },

  // Auth
  'auth.login': { de: 'Anmelden', en: 'Sign In' },
  'auth.signup': { de: 'Registrieren', en: 'Sign Up' },
  'auth.email': { de: 'E-Mail', en: 'Email' },
  'auth.password': { de: 'Passwort', en: 'Password' },
  'auth.fullName': { de: 'Vollständiger Name', en: 'Full Name' },
  'auth.orgName': { de: 'Firmenname', en: 'Organization Name' },
  'auth.noAccount': { de: 'Noch kein Konto?', en: "Don't have an account?" },
  'auth.hasAccount': { de: 'Bereits ein Konto?', en: 'Already have an account?' },
  'auth.welcome': { de: 'Willkommen bei BidPilot', en: 'Welcome to BidPilot' },
  'auth.subtitle': { de: 'Ihr KI-gestützter Ausschreibungs-Workspace', en: 'Your AI-powered bid workspace' },
  'auth.signingIn': { de: 'Wird angemeldet...', en: 'Signing in...' },
  'auth.signingUp': { de: 'Wird registriert...', en: 'Signing up...' },
  'auth.checkEmail': { de: 'Bitte prüfen Sie Ihre E-Mails zur Bestätigung.', en: 'Please check your email for confirmation.' },
  'auth.roleName': { de: 'Rolle im Unternehmen', en: 'Role in Company' },
  'auth.language': { de: 'Sprache', en: 'Language' },

  // Dashboard
  'dashboard.title': { de: 'Dashboard', en: 'Dashboard' },
  'dashboard.activeTenders': { de: 'Aktive Ausschreibungen', en: 'Active Tenders' },
  'dashboard.upcomingDeadlines': { de: 'Anstehende Fristen', en: 'Upcoming Deadlines' },
  'dashboard.recentUploads': { de: 'Letzte Uploads', en: 'Recent Uploads' },
  'dashboard.bidStatus': { de: 'Bid-Status', en: 'Bid Status' },
  'dashboard.noTenders': { de: 'Noch keine Ausschreibungen', en: 'No tenders yet' },
  'dashboard.noDeadlines': { de: 'Keine anstehenden Fristen', en: 'No upcoming deadlines' },
  'dashboard.noUploads': { de: 'Noch keine Uploads', en: 'No uploads yet' },
  'dashboard.createFirst': { de: 'Erstellen Sie Ihre erste Ausschreibung', en: 'Create your first tender' },
  'dashboard.dueIn': { de: 'Fällig in', en: 'Due in' },
  'dashboard.days': { de: 'Tagen', en: 'days' },

  // Tender
  'tender.new': { de: 'Neue Ausschreibung', en: 'New Tender' },
  'tender.title': { de: 'Titel', en: 'Title' },
  'tender.issuer': { de: 'Auftraggeber', en: 'Issuer' },
  'tender.type': { de: 'Typ', en: 'Type' },
  'tender.source': { de: 'Quelle', en: 'Source' },
  'tender.deadline': { de: 'Frist', en: 'Deadline' },
  'tender.status': { de: 'Status', en: 'Status' },
  'tender.create': { de: 'Ausschreibung erstellen', en: 'Create Tender' },
  'tender.creating': { de: 'Wird erstellt...', en: 'Creating...' },
  'tender.uploadFiles': { de: 'Dateien hochladen', en: 'Upload Files' },
  'tender.dropFiles': { de: 'Dateien hier ablegen oder klicken', en: 'Drop files here or click to browse' },
  'tender.public': { de: 'Öffentlich', en: 'Public' },
  'tender.private': { de: 'Privat', en: 'Private' },
  'tender.sourceTypes.simap': { de: 'SIMAP', en: 'SIMAP' },
  'tender.sourceTypes.email': { de: 'E-Mail', en: 'Email' },
  'tender.sourceTypes.upload': { de: 'Upload', en: 'Upload' },
  'tender.sourceTypes.manual': { de: 'Manuell', en: 'Manual' },
  'tender.sourceTypes.portal': { de: 'Portal', en: 'Portal' },
  'tender.language': { de: 'Sprache', en: 'Language' },

  // Workspace tabs
  'workspace.overview': { de: 'Übersicht', en: 'Overview' },
  'workspace.documents': { de: 'Dokumente', en: 'Documents' },
  'workspace.requirements': { de: 'Anforderungen', en: 'Requirements' },
  'workspace.risks': { de: 'Risiken & Fristen', en: 'Risks & Deadlines' },
  'workspace.knowledge': { de: 'Wissensabgleich', en: 'Knowledge Matches' },
  'workspace.draft': { de: 'Entwurf', en: 'Draft' },
  'workspace.checklist': { de: 'Checkliste', en: 'Checklist' },
  'workspace.notFound': { de: 'Ausschreibung nicht gefunden', en: 'Tender not found' },
  'workspace.fitScore': { de: 'Fit-Score', en: 'Fit Score' },
  'workspace.bidDecision': { de: 'Bid-Entscheidung', en: 'Bid Decision' },

  // Memory
  'memory.title': { de: 'Firmenwissen', en: 'Company Memory' },
  'memory.upload': { de: 'Asset hochladen', en: 'Upload Asset' },
  'memory.search': { de: 'Suchen...', en: 'Search...' },
  'memory.noAssets': { de: 'Noch keine Assets', en: 'No assets yet' },
  'memory.addFirst': { de: 'Laden Sie Ihr erstes Wissens-Asset hoch', en: 'Upload your first knowledge asset' },
  'memory.assetTitle': { de: 'Titel', en: 'Title' },
  'memory.assetType': { de: 'Kategorie', en: 'Category' },
  'memory.tags': { de: 'Tags', en: 'Tags' },
  'memory.types.reference': { de: 'Referenz', en: 'Reference' },
  'memory.types.certificate': { de: 'Zertifikat', en: 'Certificate' },
  'memory.types.cv': { de: 'Lebenslauf', en: 'CV' },
  'memory.types.policy': { de: 'Richtlinie', en: 'Policy' },
  'memory.types.service_description': { de: 'Leistungsbeschreibung', en: 'Service Description' },
  'memory.types.template': { de: 'Vorlage', en: 'Template' },
  'memory.types.past_answer': { de: 'Frühere Antwort', en: 'Past Answer' },

  // Common
  'common.loading': { de: 'Laden...', en: 'Loading...' },
  'common.save': { de: 'Speichern', en: 'Save' },
  'common.cancel': { de: 'Abbrechen', en: 'Cancel' },
  'common.delete': { de: 'Löschen', en: 'Delete' },
  'common.edit': { de: 'Bearbeiten', en: 'Edit' },
  'common.back': { de: 'Zurück', en: 'Back' },
  'common.empty': { de: 'Keine Daten', en: 'No data' },
  'common.error': { de: 'Ein Fehler ist aufgetreten', en: 'An error occurred' },
  'common.success': { de: 'Erfolgreich', en: 'Success' },
  'common.saving': { de: 'Wird gespeichert...', en: 'Saving...' },

  // Status
  'status.new': { de: 'Neu', en: 'New' },
  'status.in_progress': { de: 'In Bearbeitung', en: 'In Progress' },
  'status.submitted': { de: 'Eingereicht', en: 'Submitted' },
  'status.won': { de: 'Gewonnen', en: 'Won' },
  'status.lost': { de: 'Verloren', en: 'Lost' },
  'status.cancelled': { de: 'Abgebrochen', en: 'Cancelled' },
} as const;

type TranslationKey = keyof typeof translations;

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('bidpilot-lang');
    return (saved === 'en' || saved === 'de') ? saved : 'de';
  });

  const handleSetLanguage = useCallback((lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('bidpilot-lang', lang);
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    const entry = translations[key];
    if (!entry) return key;
    return entry[language] || key;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage: handleSetLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
