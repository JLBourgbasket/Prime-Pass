# Modèle des emails d’accès entreprise

Le modèle `recovery.html` reprend la présentation des emails de souscription. Il sert aux premières définitions du mot de passe et aux demandes « Mot de passe oublié », car l’application utilise Supabase Auth Recovery pour ces deux parcours.

À enregistrer dans le projet Supabase hébergé :

1. Ouvrir https://supabase.com/dashboard/project/iljpcjrzctsuluaiseww/auth/templates
2. Sélectionner **Reset password** (dans **Authentication → Emails → Templates** selon la navigation affichée).
3. Subject : **Prime Pass Entreprise — Définir votre mot de passe**.
4. Body / Source : remplacer le contenu par le HTML complet de `recovery.html`.
5. Enregistrer et demander un nouvel email depuis la fiche entreprise.

Conserver `{{ .ConfirmationURL }}` dans le bouton : Supabase fournit le lien sécurisé et la redirection autorisée. Le logo PNG est servi publiquement par `prime-assets/prime-logo.png`, sur le domaine du projet Supabase, pour rester accessible même si Netlify protège la prévisualisation. Cette fonction en lecture seule ne reçoit aucune clé et n’accède pas à la base. Les clients mail peuvent demander l’autorisation de charger les images distantes. Ce modèle Auth ne peut pas utiliser les pièces jointes CID des fonctions SMTP métier.

La présence de ce fichier dans GitHub ne modifie pas automatiquement les modèles du projet Supabase hébergé. La connexion Supabase MCP disponible ne propose pas l’édition de ces paramètres ; l’enregistrement dans le tableau de bord reste nécessaire. Aucun secret SMTP ni lien personnel de récupération ne doit être copié dans le modèle.
