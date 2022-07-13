package main

import (
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Server struct {
	Path     string
	Sessions map[string]Session
}

func (server *Server) Serve(w http.ResponseWriter, r *http.Request) {
	p := UrlParts(r.URL.Path)
	n := len(p)

	var h http.Handler
	absolutePath, err := server.SlugToAbsolutePath(p[0])
	if err != nil {
		http.NotFound(w, r)
		return
	}

	switch {
	// Deal with static files first
	case n > 1 && p[0] == "static":
		http.ServeFile(w, r, fmt.Sprintf("./%s", r.URL.Path))
		return
	case n == 0:
		h = server.get(Page{Slug: "index"}.Show)
	case n == 1 && p[0] == "signin" && r.Method == "GET":
		h = server.get(server.SignIn)
	case n == 1 && p[0] == "signin" && r.Method == "POST":
		h = server.post(server.SignIn)
	case n == 1 && p[0] == "signout" && r.Method == "GET":
		h = server.get(server.SignOut)
	case n == 1:
		h = server.get(Page{Slug: p[0], Path: absolutePath}.Show)
	case n == 2 && p[1] == "edit" && r.Method == "GET":
		h = server.restrict(server.get(Page{Slug: p[0], Path: absolutePath}.Edit))
	case n == 2 && p[1] == "edit" && r.Method == "POST":
		h = server.restrict(server.post(Page{Slug: p[0], Path: absolutePath}.Update))
	case n == 2 && p[1] == "diff" && r.Method == "GET":
		h = server.restrict(server.get(Page{Slug: p[0], Path: absolutePath}.ShowDiff))
	default:
		http.NotFound(w, r)
		return
	}
	h.ServeHTTP(w, r)
}

func (server *Server) allowMethod(h http.HandlerFunc, method string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if method != r.Method {
			w.Header().Set("Allow", method)
			http.Error(w, "405 method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h(w, r)
	}
}

func (server *Server) get(h http.HandlerFunc) http.HandlerFunc {
	return server.allowMethod(h, "GET")
}

func (server *Server) post(h http.HandlerFunc) http.HandlerFunc {
	return server.allowMethod(h, "POST")
}

func (server *Server) restrict(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if CanEdit(r) == false {
			w.WriteHeader(http.StatusUnauthorized)
			http.Error(w, "401 Unauthorized", http.StatusUnauthorized)
			return
		}
		h(w, r)
	}
}

func (server *Server) SignIn(w http.ResponseWriter, r *http.Request) {
	if CanEdit(r) {
		http.Redirect(w, r, "/", 303)
	}
	render := func(data map[string]any) {
		t := CompileTemplate("signin.html", r)
		t.ExecuteTemplate(w, "base", data)
	}
	if r.Method == "GET" {
		render(nil)
		return
	} else if r.Method == "POST" {
		r.ParseForm()
		username := r.Form.Get("username")
		password := r.Form.Get("password")
		// Return with an error if username or password are blank
		if username == "" || password == "" {
			render(map[string]any{
				"error": "Please enter your username and password.",
			})
			return
		}
		// Return with an error if username or password don't match
		if username != config.Username || password != config.Password {
			render(map[string]any{
				"error": "No account found with this username and password.",
			})
			return
		}
		// Create a new random session token
		sessionToken := uuid.NewString()
		sessionExpiry := time.Now().Add(24 * time.Hour * 30) // 30 days
		// Set the session token in the sessions map
		sessions[sessionToken] = Session{
			Username: username,
			Expiry:   sessionExpiry,
		}
		// Finally, we set the client cookie for "session_token"
		http.SetCookie(w, &http.Cookie{
			Name:    "session_token",
			Value:   sessionToken,
			Expires: sessionExpiry,
		})
		http.Redirect(w, r, "/", 303)
	}
}

func (server *Server) SignOut(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("session_token")
	// On an error, there's either no cookie, or some other problem.
	// Redirect the user to the home page anyway.
	if err != nil {
		http.Redirect(w, r, "/", 303)
		return
	}
	sessionToken := c.Value
	// Delete this session token from the session tokens map
	delete(sessions, sessionToken)
	// We need to let the client know that the cookie is expired
	// In the response, we set the session token to an empty
	// value and set its expiry as the current time
	http.SetCookie(w, &http.Cookie{
		Name:    "session_token",
		Value:   "",
		Expires: time.Now(),
	})
	http.Redirect(w, r, "/", 303)
}

// Returns the absolute path of an article title from a slug if that path lies
// inside the served directory and can be accessed. Otherwise returns an error.
func (server *Server) SlugToAbsolutePath(slug string) (string, error) {
	title := NormaliseTitle(slug)
	absolutePath := filepath.Join(server.Path, TitleToFilename(title))
	if !strings.HasPrefix(absolutePath, server.Path) {
		return "", errors.New("Path outside of served directory.")
	}
	// .git directory is forbidden
	if strings.HasPrefix(absolutePath, filepath.Join(server.Path, ".git")) {
		return "", errors.New("Path is forbidden.")
	}
	return absolutePath, nil
}

/* Utility functions */

type NavigationLink struct {
	label string
	url   string
}

func CompileTemplate(templateName string, req *http.Request) *template.Template {
	t, err := template.New(templateName).Funcs(template.FuncMap{
		"navigation": func(page Page) template.HTML {
			p := UrlParts(req.URL.Path)
			canEdit := CanEdit(req)
			s := []NavigationLink{
				{"Home", "/"},
			}
			if canEdit && len(p) == 1 {
				s = append(s, NavigationLink{"Edit", "/" + page.Title + "/edit"})
			}
			if canEdit && page.NumVersions > 1 {
				s = append(s, NavigationLink{"Previous versions", "/" + page.Title + "/diff"})
			}
			if len(p) == 2 && (p[1] == "edit" || p[1] == "diff") {
				s = append(s, NavigationLink{"Back", "/" + page.Title})
			}
			if !canEdit {
				s = append(s, NavigationLink{"Sign in", "/signin"})
			} else {
				s = append(s, NavigationLink{"Sign out", "/signout"})
			}

			output := "<ul class='navigation'>"
			for _, v := range s {
				output = output + fmt.Sprintf("<li class='navigation__item'><a href='%s'>%s</a></li>", v.url, v.label)
			}
			output = output + "</ul>"
			return template.HTML(output)
		},
		"siteTitle": func() string {
			if config.SiteTitle == "" {
				return "Mimir"
			}
			return config.SiteTitle
		},
	}).ParseFiles("templates/"+templateName, "templates/base.html")
	check(err)

	// compile common templates and include funcMap (see funcs.go)
	// t = template.Must(t.Funcs(funcMap).
	// 	ParseGlob("templates/common/*.html"))

	// compile particular template along with common tempaltes and funcMap
	// return template.Must(t.Funcs(funcMap).ParseFiles("templates/" + templateName))
	return t
}

func UrlParts(url string) []string {
	// Split path into slash-separated parts, for example, path "/foo/bar"
	// gives p==["foo", "bar"] and path "/" gives p==[""].
	p := strings.Split(url, "/")[1:]
	return p
}

func TitleToFilename(title string) string {
	return fmt.Sprintf("%s.md", title)
}

func CanEdit(r *http.Request) bool {
	// If editing isn't restricted to signed in users only, we simply return
	// true from this function.
	if config.RestrictEditing == false {
		return true
	}
	// Attempt to authenticate user if they have a session cookie
	var sessionToken string
	c, err := r.Cookie("session_token")
	if err == nil {
		sessionToken = c.Value
	}
	// Attempt to get session from sessions map for this token
	userSession, exists := sessions[sessionToken]
	if exists {
		if userSession.isExpired() {
			// If the session is expired, delete it from the sessions map
			delete(sessions, sessionToken)
		} else {
			// If the session is valid, return true
			return true
		}
	}
	return false
}
