export class Router {
  constructor(routes) {
    this.routes = routes;
    this.currentRoute = null;
    this.root = document.getElementById('main-content');
    
    // Bind methods
    this.handlePopState = this.handlePopState.bind(this);
    this.navigate = this.navigate.bind(this);
    
    // Listen for history changes
    window.addEventListener('popstate', this.handlePopState);
    
    // Intercept link clicks
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-link]')) {
        e.preventDefault();
        this.navigate(e.target.getAttribute('href'));
      }
    });
  }

  handlePopState() {
    this.loadRoute(location.pathname);
  }

  navigate(url) {
    history.pushState(null, null, url);
    this.loadRoute(url);
  }

  async loadRoute(url) {
    // Basic route matching
    const match = this.routes.find(route => {
        // Simple exact match for now, can extend to regex
        return route.path === url;
    }) || this.routes.find(r => r.path === '/404') || this.routes[0]; // Default to first or 404

    this.currentRoute = match;
    
    // Update active state in sidebar
    this.updateActiveLinks(url);

    if (match.view) {
      this.root.innerHTML = ''; // Clear current content
      const viewContent = await match.view();
      if (typeof viewContent === 'string') {
        this.root.innerHTML = viewContent;
      } else if (viewContent instanceof Node) {
        this.root.appendChild(viewContent);
      }
    }
  }
  
  updateActiveLinks(url) {
      document.querySelectorAll('.nav-link').forEach(link => {
          if(link.getAttribute('href') === url) {
              link.classList.add('active');
          } else {
              link.classList.remove('active');
          }
      });
  }
}
