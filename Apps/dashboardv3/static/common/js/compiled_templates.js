(function(){dust.register("app",body_0);function body_0(chk,ctx){return chk.write("<div class=\"app-card gradient\" data-id=\"").reference(ctx.get("name"),ctx,"h").write("\"><div class=\"left-side\"><div class=\"description\">").reference(ctx.getPath(false,["app","repository","desc"]),ctx,"h").write("</div><div class=\"screenshot\" style=\"top: 0px; \"><img src=\"https://burrow.singly.com/registry/").reference(ctx.getPath(false,["app","name"]),ctx,"h").write("/screenshot.png\"></div></div><div class=\"app-info\"><p class=\"title\">").reference(ctx.getPath(false,["app","repository","title"]),ctx,"h").write("</p><p class=\"author\"><a class=\"orange parentLink iframeLink\" href=\"#\" data-id=\"Explore-Author-author=").reference(ctx.getPath(false,["app","author","name"]),ctx,"h").write("\">by ").reference(ctx.getPath(false,["app","author","name"]),ctx,"h").write("</a></p><p class=\"uses\">").exists(ctx.getPath(false,["app","repository","uses","types"]),ctx,{"block":body_1},null).write("</p>").exists(ctx.get("connect"),ctx,{"block":body_4},null).write("</div></div>");}function body_1(chk,ctx){return chk.write("Uses ").section(ctx.getPath(false,["app","repository","uses","types"]),ctx,{"block":body_2},null);}function body_2(chk,ctx){return chk.write("<a class=\"blue parentLink iframeLink\" href=\"#\" data-id=\"Explore-Filter-types=").reference(ctx.getPath(true,[]),ctx,"h").write("\">").reference(ctx.getPath(true,[]),ctx,"h").write("</a>").helper("sep",ctx,{"block":body_3},null);}function body_3(chk,ctx){return chk.write(" + ");}function body_4(chk,ctx){return chk.write("Connect ").section(ctx.get("connect"),ctx,{"block":body_5},null);}function body_5(chk,ctx){return chk.write("<a href=\"/auth/").reference(ctx.getPath(true,["handle"]),ctx,"h").write("\" class=\"orange oauthLink\" data-provider=\"").reference(ctx.getPath(true,["handle"]),ctx,"h").write("\" data-width=\"").reference(ctx.getPath(true,["oauthSize","width"]),ctx,"h").write("\" data-height=\"").reference(ctx.getPath(true,["oauthSize","height"]),ctx,"h").write("\">").reference(ctx.getPath(true,["title"]),ctx,"h").write("</a>").helper("sep",ctx,{"block":body_6},null);}function body_6(chk,ctx){return chk.write(" + ");}return body_0;})();
(function(){dust.register("appDetails",body_0);function body_0(chk,ctx){return chk.write("<span><div class=\"full-app-details gradient\"><div class=\"screenshot-container\"><img src=\"https://burrow.singly.com/registry/").reference(ctx.get("name"),ctx,"h").write("/screenshot.png\"></div><div class=\"full-app-info\"><div class=\"action-buttons\"><!-- <a href=\"#\" class=\"share-button twitter\">TWEET THIS</a><a href=\"#\" class=\"share-button facebook\">SHARE IT</a> --></div><p class=\"title\">").reference(ctx.getPath(false,["repository","title"]),ctx,"h").write("</p><p class=\"author\"><a class=\"orange parentLink iframeLink\" href=\"#\" data-id=\"Explore-Author-author=").reference(ctx.getPath(false,["author","name"]),ctx,"h").write("\">by ").reference(ctx.getPath(false,["author","name"]),ctx,"h").write("</a></p><p class=\"uses\">").exists(ctx.getPath(false,["repository","uses","types"]),ctx,{"block":body_1},null).write("</p><div class=\"description\">").reference(ctx.getPath(false,["repository","desc"]),ctx,"h").write("</div><div class=\"last-update\">last updated ").reference(ctx.get("updated"),ctx,"h").write("</div><div id=\"access-form\"><span><h3>Get access to this app!</h3><form class='signup-form' action=\"signup_for_beta\" method=\"get\" accept-charset=\"utf-8\"><input tabindex='40' type='text' name='email' value='' placeholder='Email' />\n<input tabindex='42' type='text' name='github' value='' placeholder='GitHub' />\n<input tabindex='41' type='checkbox' name='developer' /><label for='developer'>I'm a developer!</label>\n<input tabindex='43' type='submit' value='&nbsp;'></form></span></div></div></div></span>");}function body_1(chk,ctx){return chk.write("Uses ").section(ctx.getPath(false,["repository","uses","types"]),ctx,{"block":body_2},null);}function body_2(chk,ctx){return chk.write("<a class=\"blue parentLink iframeLink\" href=\"#\" data-id=\"Explore-Filter-types=").reference(ctx.getPath(true,[]),ctx,"h").write("\">").reference(ctx.getPath(true,[]),ctx,"h").write("</a>").helper("sep",ctx,{"block":body_3},null);}function body_3(chk,ctx){return chk.write(" + ");}return body_0;})();
(function(){dust.register("breadcrumbs",body_0);function body_0(chk,ctx){return chk.write("<ul class=\"breadcrumb\"><li><p class='first-crumb'><a class=\"parentLink iframeLink\" href=\"#\" data-id=\"Explore-Featured\">App Gallery</a></p></li><li><p>").section(ctx.get("app"),ctx,{"block":body_1},null).exists(ctx.get("filters"),ctx,{"block":body_2},null).section(ctx.get("author"),ctx,{"block":body_7},null).write("</p></li><p></p></ul>");}function body_1(chk,ctx){return chk.write("<a class=\"blue parentLink iframeLink\" href=\"#\" data-id=\"Explore-Details-app=").reference(ctx.get("name"),ctx,"h").write("\">").reference(ctx.getPath(false,["repository","title"]),ctx,"h").write("</a>");}function body_2(chk,ctx){return chk.write("apps that use ").section(ctx.get("filters"),ctx,{"block":body_3},null);}function body_3(chk,ctx){return chk.write("<a class=\"blue parentLink iframeLink\" href=\"#\" data-id=\"Explore-Filter-").section(ctx.get("type"),ctx,{"block":body_4},null).section(ctx.get("service"),ctx,{"block":body_5},null).write("\">").reference(ctx.get("name"),ctx,"h").write("</a>").helper("sep",ctx,{"block":body_6},null);}function body_4(chk,ctx){return chk.write("types=").reference(ctx.get("type"),ctx,"h");}function body_5(chk,ctx){return chk.write("services=").reference(ctx.get("service"),ctx,"h");}function body_6(chk,ctx){return chk.write(" + ");}function body_7(chk,ctx){return chk.write("<a class=\"blue parentLink iframeLink\" href=\"#\" data-id=\"Explore-Author-&amp;author=").reference(ctx.get("author"),ctx,"h").write("\">by ").reference(ctx.get("author"),ctx,"h").write("</a>");}return body_0;})();
