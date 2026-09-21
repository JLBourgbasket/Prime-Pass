# PRIME PASS

Application PWA de gestion des accès quotidiens Entreprise de PRIME Sport Santé.

## Fonctionnalités livrées

- Activation nominative d’un droit quotidien partagé par l’entreprise.
- Attribution atomique du dernier accès disponible via une fonction PostgreSQL.
- Affichage de la fréquentation et des capacités Fit / Well.
- Réservation des prestations Well et gestion du quota cryothérapie.
- Espace Entreprise avec utilisateurs, usages et onboardings.
- Console Prime avec objectifs commerciaux et suivi de capacité.
- Mode démonstration automatique lorsqu’aucun projet Supabase n’est configuré.
- PWA installable et déploiement Netlify prêt.

## Charte graphique

L’interface applique le Brand Book PRIME Sport Santé :

- Bleu Prime et Fit : `#135BB0`
- Bleu Nuit : `#030D23`
- Prime Well : `#1FA8B8`
- Prime Back : `#A9826A`
- Typographie : Avenir Next, avec Manrope comme police web de repli

Le logo présent dans `public/prime-logo-dark.jpg` est extrait du Brand Book fourni par PRIME Sport Santé.

## Démarrage local

```bash
npm install
npm run dev
```

L’application démarre en mode démonstration. Les trois espaces sont accessibles depuis le menu : utilisateur, entreprise et Prime.

## Connexion Supabase

1. Créer un projet Supabase.
2. Exécuter `supabase/migrations/202609220001_prime_pass.sql` dans l’éditeur SQL ou via la CLI.
3. Copier `.env.example` vers `.env.local`.
4. Renseigner `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`.
5. Ne jamais exposer la clé `service_role` dans le front-end.

L’appel `claim_daily_access()` verrouille le contrat actif pendant l’attribution. Deux clics simultanés sur le dernier droit ne peuvent donc pas créer de dépassement.

## Déploiement Netlify

- Build command : `npm run build`
- Publish directory : `dist`
- Variables : `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

Le fichier `netlify.toml` et la redirection SPA sont déjà présents.

## Règle métier structurante

Le contrôle d’accès physique n’est pas intégré à l’application. Le bracelet reste le moyen d’identification et d’ouverture de porte ; PRIME PASS constitue la source de vérité pour l’attribution contractuelle des droits quotidiens.
