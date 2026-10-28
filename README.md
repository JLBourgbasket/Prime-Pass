# Prime Pass Entreprise

Gestion interne des droits mutualisés du Pass Entreprise de Prime Sport Santé. Xplor reste responsable des réservations de prestations, de l’application membre et des contrôles d’accès physiques. Une attribution dans Prime Pass ne prouve pas un passage au centre.

## Deux espaces

- **Prime** : création des comptes partagés entreprise (nom, contact, e-mail, téléphone, logo facultatif, import par fichier ou collage d’image), contrats, liste des bénéficiaires, planning, consommations et corrections cryo.
- **Entreprise** : compte partagé, administration des bénéficiaires nominatifs, compteur du jour, attribution aujourd’hui et sur les 14 prochains jours, annulation libre à tout moment, quota cryo en lecture et historique.

Le quota d’un contrat est calculé en base : **20 séances cryo par droit quotidien acheté**. Les renouvellements ont leur propre période et leur propre quota ; les contrats ne peuvent pas se chevaucher. Une correction cryo exige un motif et restitue exactement un crédit. Les bénéficiaires sont désactivés sans effacer leur historique ; leur désactivation libère leurs attributions d’aujourd’hui et à venir.

## Architecture

- React / TypeScript / Vite, interface blanche, logo et monogramme Prime fournis.
- Netlify héberge uniquement l’interface statique.
- Supabase Auth gère les connexions et la récupération des mots de passe.
- L’Edge Function `prime-pass` vérifie chaque session avec `auth.getUser()`, puis appelle une fonction PostgreSQL réservée au serveur. Aucune clé serveur ne doit être ajoutée à Netlify ni à une variable `VITE_`.
- Les tables métier sont dans le schéma privé `prime_pass`, sans droit de lecture ou d’écriture pour les navigateurs. RLS y reste activée en défense supplémentaire.
- Les tables `claims` et `cryo` conservent leurs enregistrements annulés/corrigés. Les opérations sont journalisées.
- Un verrou par entreprise sérialise attributions, annulations et modifications de contrat. L’état affiché n’est modifié qu’après confirmation du serveur.
- Supabase Realtime transmet uniquement un identifiant d’entreprise et une révision via `public.prime_pass_updates`. La politique de lecture limite chaque compte à son entreprise, ou à toutes les entreprises pour Prime. Un changement déclenche la relecture de l’état métier. Actualisation de secours toutes les 60 secondes, au retour dans l’onglet et au rétablissement du réseau.
- Le jour de référence est calculé par PostgreSQL dans le fuseau `Europe/Paris`.

## État de l’installation du 28 octobre 2026

Projet Supabase : `iljpcjrzctsuluaiseww` (Prime Pass, compte Prime Sport Santé).

Les deux migrations v2 ont été installées et testées sur ce projet ; les fixtures ont été exécutées dans une transaction annulée, sans conserver de comptes ou d’entreprises fictifs. La fonction Edge `prime-pass` est déployée. Les appels sans session ou avec une session invalide sont refusés.

**À terminer avant utilisation réelle :** premier compte administrateur Prime, configuration des e-mails et des URLs Auth, et déploiement de cette branche sur le nouveau site Netlify. Les parcours de connexion réelle et d’envoi des e-mails doivent ensuite être validés de bout en bout.

AGIR et son logo servent seulement d’exemple dans le mode de démonstration explicite ; aucune fiche AGIR réelle n’est préremplie.

## Netlify

Site cible : `primepassentreprise` ; Project ID communiqué : `d0a8e3ca-e883-4f59-8ac4-188d4f49a27c`.

Relier le nouveau site à ce dépôt et à la branche de refonte. Éviter de fusionner sur `main` tant que l’ancien site Netlify suit encore cette branche si l’on veut conserver sa version actuelle.

- Commande : `npm run build`
- Dossier publié : `dist`
- Variables publiques : `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (voir `.env.example`).
- `VITE_ENABLE_DEMO=false` en production. Sans configuration, l’application montre un écran de connexion indisponible ; elle ne bascule jamais automatiquement sur des données fictives.

Le service Edge accepte par défaut l’origine `https://primepassentreprise.netlify.app`. Pour changer le domaine final, configurer `SITE_URL` dans les secrets de l’Edge Function et ajouter la même URL aux redirections autorisées de Supabase Auth. La prévisualisation `https://deploy-preview-1--primepassentreprise.netlify.app` est explicitement autorisée pour les tests. Les autres adresses de prévisualisation restent refusées. Toutes les opérations exigent une session valide, y compris sur la prévisualisation.

## Auth et e-mails

Dans Supabase Auth, définir Site URL et Redirect URLs sur l’adresse finale du nouveau site. Configurer un SMTP de production pour les e-mails aux contacts des entreprises ; le service d’envoi par défaut est limité et ne suffit pas à garantir l’envoi à des contacts externes.

1. Choisir explicitement l’adresse du premier administrateur Prime.
2. Créer/inviter cet utilisateur depuis Supabase Auth et lui faire confirmer son adresse et définir son mot de passe.
3. Exécuter `supabase/bootstrap-admin.sql` après avoir remplacé l’adresse de démonstration par cette adresse exacte. Ce script exige un utilisateur Auth existant et confirmé ; il n’envoie aucun message et ne crée aucun mot de passe.
4. Vérifier une connexion Prime, créer une entreprise de test avec une adresse que vous contrôlez, puis vérifier la connexion du compte partagé.

Il n’y a pas d’inscription libre dans l’interface. Un utilisateur Auth sans entrée dans `prime_pass.accounts` ne peut pas accéder aux données métier. Les comptes entreprise sont créés par Prime avec un mot de passe aléatoire non divulgué ; le contact reçoit un lien pour choisir le sien. Si l’envoi échoue, la fiche est conservée et Prime peut renvoyer le lien depuis la console.

## Installation d’une nouvelle base

Sur une base vierge, exécuter dans cet ordre :

1. `supabase/prime_pass_v2.sql`
2. `supabase/realtime.sql`
3. Déployer `supabase/functions/prime-pass/index.ts` et son module partagé.

La vérification JWT de la passerelle Edge est désactivée au profit de la validation explicite de la session dans le handler (`auth.getUser(token)`) avant toute opération métier. Aucune action métier n’est anonyme. Les clés serveur proviennent uniquement des variables automatiques Supabase `SUPABASE_SECRET_KEYS` ou de leur équivalent historique.

L’ancienne migration de septembre est conservée sous `supabase/legacy/` pour référence, et ne doit pas être appliquée à la v2. Les fichiers SQL à la racine de `supabase/` sont les sources lisibles testées. Les copies dans `supabase/migrations/` correspondent aux versions effectivement générées par Supabase pour ce nouveau projet.

Les sept avis informatifs « RLS enabled, no policy » du schéma privé sont attendus : les accès directs sont intentionnellement refusés ; seul le serveur utilise ces tables. La table publique de notification dispose de sa propre politique. Voir [la documentation du contrôle RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Développement et vérification

```bash
npm ci
npm test
npm run typecheck:server
npm run build
npm run dev -- --host 127.0.0.1
```

Node 22.6 ou plus récent est requis pour les tests TypeScript natifs ; Node 24 recommandé.

Pour une démonstration **locale et explicitement signalée** :

```bash
VITE_ENABLE_DEMO=true npm run dev -- --host 127.0.0.1
```

Ouvrir `/?demo=1`. Les actions utilisent uniquement le stockage local du navigateur et n’envoient aucun e-mail. Le mode démo n’est pas une simulation des protections du serveur : celles-ci sont vérifiées séparément par les tests PostgreSQL.

Les tests couvrent la séparation des comptes, le refus des écritures directes, les quotas, les répétitions de requêtes, les annulations, les corrections cryo, les renouvellements et les notifications filtrées.

## Aperçus vérifiés

Les captures utilisent exclusivement des données fictives signalées dans l’interface.

![Accueil entreprise](docs/enterprise-preview.webp)

![Console Prime](docs/admin-preview.webp)
