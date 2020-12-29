// create HTML object
output = new bs.HTML(htmlEscaper.escape(cmsPage._id == 'home' ? packageInfo.description : cmsPage.title));

// enable Bootstrap
output.bootstrap(
    this.settings.bootstrapCSS,
    this.settings.bootstrapJS,
    true,
    this.settings.jqueryJS,
    this.settings.popperJS,
    this.settings.fontawesomeCSS
);

// set HTML description to page description/excerpt
const pageDescription = cmsPage.description ? cmsPage.description : cmsPage.excerpt;
if (pageDescription)
    output.metadata('description', htmlEscaper.escape(pageDescription));

// page container
const pageContainer = new bs.Container();
pageContainer.paddingY = 3;

// page title and tagline
pageContainer.displayHeading1(cmsPage._id != 'home' ? cmsPage.title : this.settings.title);
const pageTagline = cmsPage.tagline ? cmsPage.tagline : (cmsPage._id == 'home' ? this.settings.tagline : null);
if (pageTagline)
    pageContainer.paragraph(new bs.Italics(pageTagline), { leading: true, textTheme: 'muted' });
//////////////////// TEMPLATE DIVIDER ////////////////////
//////////////////// TEMPLATE DIVIDER ////////////////////
// TODO: page navigation