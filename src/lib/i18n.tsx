import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type Language = 'de' | 'en';

const translations = {
  // Navigation
  'nav.dashboard': { de: 'Dashboard', en: 'Dashboard' },
  'nav.tenders': { de: 'Ausschreibungen', en: 'Tenders' },
  'nav.newTender': { de: 'Neue Ausschreibung', en: 'New Tender' },
  'nav.memory': { de: 'Firmenwissen', en: 'Company Memory' },
  'nav.checklist': { de: 'Checkliste', en: 'Checklist' },
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

  // Onboarding
  'onboarding.title': { de: 'Organisation erstellen', en: 'Create Organization' },
  'onboarding.subtitle': { de: 'Erstellen Sie Ihre Organisation, um BidPilot zu nutzen.', en: 'Create your organization to start using BidPilot.' },
  'onboarding.name': { de: 'Organisationsname', en: 'Organization Name' },
  'onboarding.namePlaceholder': { de: 'z.B. Muster AG', en: 'e.g. Acme Corp' },
  'onboarding.industry': { de: 'Branche', en: 'Industry' },
  'onboarding.industryPlaceholder': { de: 'z.B. IT, Bau, Beratung', en: 'e.g. IT, Construction, Consulting' },
  'onboarding.size': { de: 'Unternehmensgrösse', en: 'Company Size' },
  'onboarding.language': { de: 'Standardsprache', en: 'Default Language' },
  'onboarding.create': { de: 'Organisation erstellen', en: 'Create Organization' },
  'onboarding.creating': { de: 'Wird erstellt...', en: 'Creating...' },

  // Dashboard
  'dashboard.title': { de: 'Dashboard', en: 'Dashboard' },
  'dashboard.welcome': { de: 'Willkommen zurück', en: 'Welcome back' },
  'dashboard.activeTenders': { de: 'Aktive Ausschreibungen', en: 'Active Tenders' },
  'dashboard.upcomingDeadlines': { de: 'Anstehende Fristen', en: 'Upcoming Deadlines' },
  'dashboard.recentUploads': { de: 'Letzte Uploads', en: 'Recent Uploads' },
  'dashboard.bidStatus': { de: 'Bid-Status Übersicht', en: 'Bid Status Summary' },
  'dashboard.openChecklist': { de: 'Offene Aufgaben', en: 'Open Tasks' },
  'dashboard.noTenders': { de: 'Noch keine Ausschreibungen', en: 'No tenders yet' },
  'dashboard.noDeadlines': { de: 'Keine anstehenden Fristen', en: 'No upcoming deadlines' },
  'dashboard.noUploads': { de: 'Noch keine Uploads', en: 'No uploads yet' },
  'dashboard.noChecklist': { de: 'Keine offenen Aufgaben', en: 'No open tasks' },
  'dashboard.createFirst': { de: 'Erstellen Sie Ihre erste Ausschreibung', en: 'Create your first tender' },
  'dashboard.totalTenders': { de: 'Total Ausschreibungen', en: 'Total Tenders' },
  'dashboard.pendingDeadlines': { de: 'Offene Fristen', en: 'Pending Deadlines' },
  'dashboard.documentsUploaded': { de: 'Dokumente', en: 'Documents' },
  'dashboard.openItems': { de: 'Offene Punkte', en: 'Open Items' },
  'dashboard.viewAll': { de: 'Alle anzeigen', en: 'View all' },

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
  'tender.uploadFiles': { de: 'Dokumente hochladen', en: 'Upload Documents' },
  'tender.dropFiles': { de: 'Dateien hierher ziehen oder klicken zum Durchsuchen', en: 'Drag files here or click to browse' },
  'tender.dropFilesActive': { de: 'Dateien hier ablegen...', en: 'Drop files here...' },
  'tender.public': { de: 'Öffentlich', en: 'Public' },
  'tender.private': { de: 'Privat', en: 'Private' },
  'tender.sourceTypes.simap': { de: 'SIMAP', en: 'SIMAP' },
  'tender.sourceTypes.email': { de: 'E-Mail', en: 'Email' },
  'tender.sourceTypes.upload': { de: 'Upload', en: 'Upload' },
  'tender.sourceTypes.manual': { de: 'Manuell', en: 'Manual' },
  'tender.sourceTypes.portal': { de: 'Portal', en: 'Portal' },
  'tender.language': { de: 'Sprache', en: 'Language' },
  'tender.simapLink': { de: 'SIMAP Link', en: 'SIMAP Link' },
  'tender.simapLinkPlaceholder': { de: 'https://www.simap.ch/...', en: 'https://www.simap.ch/...' },
  'tender.filesSelected': { de: 'Dateien ausgewählt', en: 'files selected' },
  'tender.details': { de: 'Details', en: 'Details' },
  'tender.sourceAndType': { de: 'Quelle & Typ', en: 'Source & Type' },
  'tender.noTenders': { de: 'Keine Ausschreibungen', en: 'No tenders' },
  'tender.allTenders': { de: 'Alle Ausschreibungen', en: 'All Tenders' },
  'tender.created': { de: 'Ausschreibung erstellt', en: 'Tender created' },
  'tender.createdDescription': { de: 'Dokumente werden verarbeitet...', en: 'Documents are being processed...' },
  'tender.goToWorkspace': { de: 'Zum Workspace', en: 'Go to Workspace' },
  'tender.processingTender': { de: 'Ausschreibung wird analysiert...', en: 'Processing tender...' },
  'tender.processingDescription': { de: 'Die KI analysiert Ihre Dokumente. Dies kann einen Moment dauern.', en: 'AI is analyzing your documents. This may take a moment.' },
  'tender.deleteTender': { de: 'Ausschreibung löschen', en: 'Delete Tender' },
  'tender.deleteConfirm': { de: 'Diese Ausschreibung und alle zugehörigen Daten (Dokumente, Anforderungen, Entwürfe usw.) werden dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.', en: 'This tender and all associated data (documents, requirements, drafts, etc.) will be permanently deleted. This action cannot be undone.' },
  'tender.deleteSuccess': { de: 'Ausschreibung gelöscht', en: 'Tender deleted' },
  'workspace.retryProcessing': { de: 'Verarbeitung wiederholen', en: 'Retry Processing' },

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
  'workspace.deleteDocument': { de: 'Dokument löschen', en: 'Delete Document' },
  'workspace.deleteDocumentConfirm': { de: 'Dieses Dokument wird dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.', en: 'This document will be permanently deleted. This action cannot be undone.' },
  'workspace.documentDeleted': { de: 'Dokument gelöscht', en: 'Document deleted' },
  'workspace.noDocuments': { de: 'Noch keine Dokumente hochgeladen', en: 'No documents uploaded yet' },
  'workspace.noRequirements': { de: 'Noch keine Anforderungen extrahiert', en: 'No requirements extracted yet' },
  'workspace.noRisks': { de: 'Keine Risiken identifiziert', en: 'No risks identified' },
  'workspace.noDeadlines': { de: 'Keine Fristen definiert', en: 'No deadlines defined' },
  'workspace.noKnowledge': { de: 'Keine Wissensabgleiche verfügbar', en: 'No knowledge matches available' },
  'workspace.noDraft': { de: 'Noch keine Entwurfsabschnitte', en: 'No draft sections yet' },
  'workspace.noChecklist': { de: 'Keine Checklisten-Einträge', en: 'No checklist items' },
  'workspace.mandatory': { de: 'Pflicht', en: 'Mandatory' },
  'workspace.optional': { de: 'Optional', en: 'Optional' },
  'workspace.category': { de: 'Kategorie', en: 'Category' },
  'workspace.severity': { de: 'Schweregrad', en: 'Severity' },
  'workspace.risks.title': { de: 'Risiken', en: 'Risks' },
  'workspace.deadlines.title': { de: 'Fristen', en: 'Deadlines' },
  'workspace.fileName': { de: 'Dateiname', en: 'File Name' },
  'workspace.fileType': { de: 'Typ', en: 'Type' },
  'workspace.parseStatus': { de: 'Parse-Status', en: 'Parse Status' },
  'workspace.uploadDate': { de: 'Upload-Datum', en: 'Upload Date' },
  'workspace.requirement': { de: 'Anforderung', en: 'Requirement' },
  'workspace.suggestedAssets': { de: 'Vorgeschlagene Assets', en: 'Suggested Assets' },
  'workspace.confidence': { de: 'Konfidenz', en: 'Confidence' },
  'workspace.knowledgeHint': { de: 'Anforderungen werden automatisch mit Ihrem Firmenwissen abgeglichen', en: 'Requirements will be automatically matched with your company knowledge' },
  'workspace.draftSections': { de: 'Entwurfsabschnitte', en: 'Draft Sections' },
  'workspace.readiness': { de: 'Einreichungsbereitschaft', en: 'Submission Readiness' },
  'workspace.missingItems': { de: 'Fehlende Punkte', en: 'Missing Items' },
  'workspace.completedItems': { de: 'Erledigte Punkte', en: 'Completed Items' },
  'workspace.owner': { de: 'Verantwortlich', en: 'Owner' },
  'workspace.unassigned': { de: 'Nicht zugewiesen', en: 'Unassigned' },
  'workspace.filter.all': { de: 'Alle', en: 'All' },
  'workspace.filter.mine': { de: 'Meine', en: 'Mine' },
  'workspace.filter.unassigned': { de: 'Offen', en: 'Unassigned' },
  'workspace.noFilterResults': { de: 'Keine Einträge für diesen Filter', en: 'No items match this filter' },
  'workspace.noComments': { de: 'Noch keine Kommentare', en: 'No comments yet' },
  'workspace.addComment': { de: 'Kommentar hinzufügen...', en: 'Add a comment...' },
  'workspace.recentActivity': { de: 'Letzte Aktivität', en: 'Recent Activity' },

  // Activity types
  'activity.tender_created': { de: 'hat die Ausschreibung erstellt', en: 'created the tender' },
  'activity.document_uploaded': { de: 'hat ein Dokument hochgeladen', en: 'uploaded a document' },
  'activity.processing_complete': { de: 'hat die Verarbeitung abgeschlossen', en: 'completed processing' },
  'activity.response_generated': { de: 'hat einen Entwurf generiert', en: 'generated a draft' },
  'activity.checklist_assigned': { de: 'hat eine Aufgabe zugewiesen', en: 'assigned a task' },
  'activity.checklist_completed': { de: 'hat eine Aufgabe erledigt', en: 'completed a task' },
  'activity.checklist_reopened': { de: 'hat eine Aufgabe wiedereröffnet', en: 'reopened a task' },
  'activity.comment_added': { de: 'hat einen Kommentar hinzugefügt', en: 'added a comment' },
  'activity.document_deleted': { de: 'hat ein Dokument gelöscht', en: 'deleted a document' },

  // Notifications
  'notifications.title': { de: 'Benachrichtigungen', en: 'Notifications' },
  'notifications.markAllRead': { de: 'Alle gelesen', en: 'Mark all read' },
  'notifications.empty': { de: 'Keine Benachrichtigungen', en: 'No notifications' },
  'workspace.dueDate': { de: 'Fällig', en: 'Due' },
  'workspace.processingStatus': { de: 'Verarbeitungsstatus', en: 'Processing Status' },
  'workspace.processingHint': { de: 'Dokumente werden analysiert. Anforderungen, Risiken und Fristen werden nach der Verarbeitung angezeigt.', en: 'Documents are being analyzed. Requirements, risks, and deadlines will appear after processing.' },
  'workspace.allParsed': { de: 'Alle Dokumente verarbeitet', en: 'All documents processed' },
  'workspace.savingDraft': { de: 'Entwurf wird gespeichert...', en: 'Saving draft...' },
  'workspace.draftSaved': { de: 'Entwurf gespeichert', en: 'Draft saved' },
  'workspace.clarifications': { de: 'Klarstellungen', en: 'Clarifications' },
  'workspace.noClarifications': { de: 'Noch keine Klarstellungsfragen', en: 'No clarification questions yet' },
  'workspace.clarificationsGenerated': { de: 'Klarstellungsfragen generiert', en: 'Clarification questions generated' },
  'workspace.questionsGenerated': { de: 'Fragen generiert', en: 'questions generated' },
  'workspace.questionSaved': { de: 'Frage gespeichert', en: 'Question saved' },
  'status.sent': { de: 'Gesendet', en: 'Sent' },
  'status.answered': { de: 'Beantwortet', en: 'Answered' },

  // Parse status
  'workspace.parseStatus.pending': { de: 'Ausstehend', en: 'Pending' },
  'workspace.parseStatus.processing': { de: 'Wird verarbeitet', en: 'Processing' },
  'workspace.parseStatus.parsed': { de: 'Verarbeitet', en: 'Parsed' },
  'workspace.parseStatus.failed': { de: 'Fehlgeschlagen', en: 'Failed' },

  // Memory
  'memory.title': { de: 'Firmenwissen', en: 'Company Memory' },
  'memory.subtitle': { de: 'Verwalten Sie Ihr internes Wissen für Ausschreibungen', en: 'Manage your internal knowledge for tenders' },
  'memory.upload': { de: 'Asset hochladen', en: 'Upload Asset' },
  'memory.search': { de: 'Suchen nach Titel, Tags...', en: 'Search by title, tags...' },
  'memory.noAssets': { de: 'Noch keine Assets', en: 'No assets yet' },
  'memory.addFirst': { de: 'Laden Sie Ihr erstes Wissens-Asset hoch', en: 'Upload your first knowledge asset' },
  'memory.deleteAsset': { de: 'Asset löschen', en: 'Delete Asset' },
  'memory.deleteAssetConfirm': { de: 'Dieses Wissens-Asset und alle zugehörigen Matches werden dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.', en: 'This knowledge asset and all associated matches will be permanently deleted. This action cannot be undone.' },
  'memory.assetDeleted': { de: 'Asset gelöscht', en: 'Asset deleted' },
  'memory.assetTitle': { de: 'Titel', en: 'Title' },
  'memory.assetType': { de: 'Kategorie', en: 'Category' },
  'memory.tags': { de: 'Tags', en: 'Tags' },
  'memory.filterByType': { de: 'Nach Kategorie filtern', en: 'Filter by category' },
  'memory.allTypes': { de: 'Alle Kategorien', en: 'All Categories' },
  'memory.types.reference': { de: 'Referenz', en: 'Reference' },
  'memory.types.certificate': { de: 'Zertifikat', en: 'Certificate' },
  'memory.types.cv': { de: 'Lebenslauf', en: 'CV' },
  'memory.types.policy': { de: 'Richtlinie', en: 'Policy' },
  'memory.types.service_description': { de: 'Leistungsbeschreibung', en: 'Service Description' },
  'memory.types.template': { de: 'Vorlage', en: 'Template' },
  'memory.types.past_answer': { de: 'Frühere Antwort', en: 'Past Answer' },
  'memory.totalAssets': { de: 'Total Assets', en: 'Total Assets' },

  // Bulk Upload
  'memory.dropFilesMultiple': { de: 'Dateien hier ablegen oder klicken zum Auswählen', en: 'Drop files here or click to select' },
  'memory.bulkUploadAll': { de: 'Alle hochladen', en: 'Upload All' },
  'memory.bulkAnalyzing': { de: 'KI analysiert...', en: 'AI analyzing...' },
  'memory.bulkReady': { de: 'Bereit', en: 'Ready' },
  'memory.bulkError': { de: 'Analyse fehlgeschlagen', en: 'Analysis failed' },
  'memory.bulkUploading': { de: 'Wird hochgeladen...', en: 'Uploading...' },
  'memory.bulkDone': { de: 'Fertig', en: 'Done' },
  'memory.bulkSuccess': { de: 'Assets erfolgreich hochgeladen', en: 'Assets uploaded successfully' },
  'memory.removeFile': { de: 'Datei entfernen', en: 'Remove file' },

  // Tender AI Prefill
  'tender.aiAnalyzing': { de: 'KI analysiert Ihre Dokumente...', en: 'AI analyzing your documents...' },

  // Checklist (standalone)
  'checklist.title': { de: 'Checkliste', en: 'Checklist' },
  'checklist.subtitle': { de: 'Alle offenen Aufgaben über alle Ausschreibungen', en: 'All open tasks across all tenders' },
  'checklist.noItems': { de: 'Keine Checklisten-Einträge', en: 'No checklist items' },

  // Settings
  'settings.title': { de: 'Einstellungen', en: 'Settings' },
  'settings.profile': { de: 'Profil', en: 'Profile' },
  'settings.organization': { de: 'Organisation', en: 'Organization' },
  'settings.team': { de: 'Team', en: 'Team' },
  'settings.comingSoon': { de: 'Demnächst verfügbar', en: 'Coming soon' },
  'settings.profileDescription': { de: 'Verwalten Sie Ihre persönlichen Informationen', en: 'Manage your personal information' },
  'settings.profileSaved': { de: 'Profil gespeichert', en: 'Profile saved' },
  'settings.email': { de: 'E-Mail', en: 'Email' },
  'settings.orgDescription': { de: 'Verwalten Sie Ihre Organisationseinstellungen', en: 'Manage your organization settings' },
  'settings.orgSaved': { de: 'Organisation gespeichert', en: 'Organization saved' },
  'settings.inviteMember': { de: 'Mitglied einladen', en: 'Invite Member' },
  'settings.inviteHint': { de: 'Laden Sie Teammitglieder per E-Mail ein', en: 'Invite team members by email' },
  'settings.invite': { de: 'Einladen', en: 'Invite' },
  'settings.inviteSent': { de: 'Einladung gesendet', en: 'Invitation sent' },
  'settings.inviteDescription': { de: 'Die Einladung wurde versendet', en: 'The invitation has been sent' },
  'settings.members': { de: 'Mitglieder', en: 'members' },
  'settings.unnamed': { de: 'Unbenannt', en: 'Unnamed' },
  'settings.you': { de: 'Sie', en: 'You' },
  'settings.makeAdmin': { de: 'Admin ernennen', en: 'Make Admin' },
  'settings.removeAdmin': { de: 'Admin entfernen', en: 'Remove Admin' },
  'settings.removeMemberTitle': { de: 'Mitglied entfernen', en: 'Remove Member' },
  'settings.removeMemberConfirm': { de: 'Dieses Mitglied wird aus der Organisation entfernt. Es verliert den Zugriff auf alle Ausschreibungen und Daten.', en: 'This member will be removed from the organization. They will lose access to all tenders and data.' },
  'settings.memberRemoved': { de: 'Mitglied entfernt', en: 'Member removed' },

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
  'common.of': { de: 'von', en: 'of' },

  // Status
  'status.new': { de: 'Neu', en: 'New' },
  'status.in_progress': { de: 'In Bearbeitung', en: 'In Progress' },
  'status.submitted': { de: 'Eingereicht', en: 'Submitted' },
  'status.won': { de: 'Gewonnen', en: 'Won' },
  'status.lost': { de: 'Verloren', en: 'Lost' },
  'status.cancelled': { de: 'Abgebrochen', en: 'Cancelled' },
  'status.open': { de: 'Offen', en: 'Open' },
  'status.done': { de: 'Erledigt', en: 'Done' },
  'status.draft': { de: 'Entwurf', en: 'Draft' },
  'status.review': { de: 'Review', en: 'Review' },
  'status.in_review': { de: 'In Prüfung', en: 'In Review' },
  'status.approved': { de: 'Genehmigt', en: 'Approved' },
  'status.analyzing': { de: 'Wird analysiert', en: 'Analyzing' },
  'status.ready_for_review': { de: 'Bereit zur Prüfung', en: 'Ready for Review' },
  'status.blocked': { de: 'Blockiert', en: 'Blocked' },
  'status.parsed': { de: 'Verarbeitet', en: 'Parsed' },
  'status.processing': { de: 'Wird verarbeitet', en: 'Processing' },
  'status.failed': { de: 'Fehlgeschlagen', en: 'Failed' },
  'status.pending': { de: 'Ausstehend', en: 'Pending' },

  // Navigation - Discovery
  'nav.discover': { de: 'Entdecken', en: 'Discover' },

  // SIMAP fetch
  'simap.fetch': { de: 'Von SIMAP laden', en: 'Fetch from SIMAP' },
  'simap.fetching': { de: 'Wird geladen...', en: 'Fetching...' },
  'simap.fetchSuccess': { de: 'Daten von SIMAP geladen', en: 'Data loaded from SIMAP' },
  'simap.fetchError': { de: 'Fehler beim Laden von SIMAP', en: 'Error loading from SIMAP' },

  // Discovery page
  'discover.title': { de: 'SIMAP Entdecken', en: 'SIMAP Discovery' },
  'discover.subtitle': { de: 'Öffentliche Ausschreibungen aus SIMAP durchsuchen und importieren', en: 'Search and import public tenders from SIMAP' },
  'discover.searchPlaceholder': { de: 'Suchbegriff eingeben (mind. 3 Zeichen)', en: 'Enter search term (min. 3 characters)' },
  'discover.search': { de: 'Suchen', en: 'Search' },
  'discover.searching': { de: 'Suche läuft...', en: 'Searching...' },
  'discover.noResults': { de: 'Keine Ergebnisse', en: 'No results' },
  'discover.noResultsHint': { de: 'Versuchen Sie einen anderen Suchbegriff', en: 'Try a different search term' },
  'discover.import': { de: 'Importieren', en: 'Import' },
  'discover.importing': { de: 'Wird importiert...', en: 'Importing...' },
  'discover.imported': { de: 'Ausschreibung importiert', en: 'Tender imported' },
  'discover.importedDescription': { de: 'Die Ausschreibung wurde erfolgreich importiert', en: 'The tender has been successfully imported' },
  'discover.resultsCount': { de: 'Ergebnisse', en: 'results' },
  'discover.loadMore': { de: 'Mehr laden', en: 'Load more' },
  'discover.publicationDate': { de: 'Veröffentlicht', en: 'Published' },
  'discover.openOnSimap': { de: 'Auf SIMAP öffnen', en: 'Open on SIMAP' },
  'discover.processType': { de: 'Verfahren', en: 'Procedure' },
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
