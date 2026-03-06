import './styles/main.css';
import { Router } from './router.js';
import { store } from './store.js';
import * as Dashboard from './modules/Dashboard.js';
import * as GeneralLedger from './modules/GeneralLedger.js';

// Import View Modules (Lazy loading can be implemented later)
// For now, these are just placeholder functions
// const GeneralLedger = () => '<h1>General Ledger</h1>'; // Removed
import * as AccountsReceivable from './modules/AccountsReceivable.js';
import * as InvoiceForm from './modules/InvoiceForm.js';
import * as AccountsPayable from './modules/AccountsPayable.js';
import * as BillForm from './modules/BillForm.js';
import * as Inventory from './modules/Inventory.js';
import * as InventoryDetail from './modules/InventoryDetail.js';
import * as Banking from './modules/Banking.js';
import * as Reporting from './modules/Reporting.js';
import * as ReportDetail from './modules/ReportDetail.js';
import * as Settings from './modules/Settings.js';

// const AccountsPayable = () => '<h1>Accounts Payable</h1>'; // Removed
// const Settings = () => '<h1>Settings</h1>';

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
  const app = document.querySelector('#app');

  // Inject Shell (Sidebar + Header + Main)
  app.innerHTML = `
    <nav class="app-sidebar">
      <div style="padding: 20px; font-size: 1.2rem; font-weight: bold; color: white;">MSM Accounting</div>
      <div class="nav-links" style="display: flex; flex-direction: column; padding: 10px;">
        <a href="/" class="nav-link" data-link style="padding: 10px; color: #adb5bd; text-decoration: none;">Dashboard</a>
        <a href="/gl" class="nav-link" data-link style="padding: 10px; color: #adb5bd; text-decoration: none;">General Ledger</a>
        <a href="/ar" class="nav-link" data-link style="padding: 10px; color: #adb5bd; text-decoration: none;">Accounts Receivable</a>
        <a href="/ap" class="nav-link" data-link style="padding: 10px; color: #adb5bd; text-decoration: none;">Accounts Payable</a>
        <a href="/inventory" class="nav-link" data-link style="padding: 10px; color: #adb5bd; text-decoration: none;">Inventory</a>
        <a href="/banking" class="nav-link" data-link style="padding: 10px; color: #adb5bd; text-decoration: none;">Banking</a>
        <a href="/reports" class="nav-link" data-link style="padding: 10px; color: #adb5bd; text-decoration: none;">Reports</a>
        <a href="/settings" class="nav-link" data-link style="padding: 10px; color: #adb5bd; text-decoration: none;">Settings</a>
      </div>
    </nav>
    <header class="app-header">
      <h2>Internal Accounting</h2>
      <div class="user-profile">Admin User</div>
    </header>
    <main id="main-content" class="app-main"></main>
  `;

  // Define Routes
  const routes = [
    { path: '/', view: Dashboard.render },
    { path: '/gl', view: GeneralLedger.render },
    { path: '/ar', view: AccountsReceivable.render },
    { path: '/ar/new', view: InvoiceForm.render },
    { path: '/ap', view: AccountsPayable.render },
    { path: '/ap/new', view: BillForm.render },
    { path: '/inventory', view: Inventory.render },
    { path: '/inventory/detail', view: InventoryDetail.render },
    { path: '/banking', view: Banking.render },
    { path: '/reports', view: Reporting.render },
    { path: '/reports/view', view: ReportDetail.render },
    { path: '/settings', view: Settings.render },
  ];

  // Init Router
  const router = new Router(routes);
  router.loadRoute(location.pathname);
});
