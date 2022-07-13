package main

import (
	"bytes"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/sergi/go-diff/diffmatchpatch"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
)

type Page struct {
	Slug        string
	Path        string
	Title       string
	HtmlContent template.HTML
	RawContent  string
	Backlinks   []string
	NumVersions int
}

type DiffDisplay struct {
	Side          string
	Timestamp     int
	PrevTimestamp int
	NextTimestamp int
	DiffIndex     int
	Date          string
	RawContent    string
	DiffHtml      template.HTML
	Diff          []diffmatchpatch.Diff
}

func (page *Page) Read() {
	bytes, err := os.ReadFile(page.Path)
	check(err)
	page.RawContent = string(bytes)
}

func (page *Page) ParseMarkdown() {
	// First, convert wiki-style links into Markdown style links
	re := regexp.MustCompile(`\[\[(.*?)\]\]`)
	contentWithMarkdownLinks := re.ReplaceAllStringFunc(page.RawContent, func(m string) string {
		trimmedString := strings.Trim(m, "[] ")
		normalisedTitle := NormaliseTitle(trimmedString)
		return fmt.Sprintf("[%s](%s)", trimmedString, normalisedTitle)
	})

	// Convert Markdown into HTML
	var buf bytes.Buffer
	b := []byte(contentWithMarkdownLinks)
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithParserOptions(
			parser.WithAutoHeadingID(),
		),
		goldmark.WithRendererOptions(
			html.WithHardWraps(),
			html.WithXHTML(),
		),
	)
	if err := md.Convert(b, &buf); err != nil {
		panic(err)
	}
	page.HtmlContent = template.HTML(buf.String())
}

func (page Page) Show(w http.ResponseWriter, req *http.Request) {
	_, err := os.Stat(page.Path)
	if err == nil {
		t := CompileTemplate("page.html", req)
		page.Title = NormaliseTitle(page.Slug)
		page.Read()
		page.ParseMarkdown()
		page.NumVersions = len(page.GetPatches())
		t.ExecuteTemplate(w, "base", page)
	} else {
		t := CompileTemplate("new.html", req)
		page.Title = NormaliseTitle(page.Slug)
		t.ExecuteTemplate(w, "base", page)
	}
}

func (page Page) Edit(w http.ResponseWriter, req *http.Request) {
	t := CompileTemplate("edit.html", req)
	page.Title = NormaliseTitle(page.Slug)
	_, err := os.Stat(page.Path)
	if err == nil {
		page.Read()
	} else {
		page.RawContent = ""
	}
	// If we're passed a specific timestamp, show the version of the page
	// matching that timestamp instead of the current version
	version, err := strconv.Atoi(req.URL.Query().Get("version"))
	if err == nil {
		page.RawContent, _, err = page.GetVersion(version)
		if err != nil {
			// If there's no version for this timestamp, redirect to
			// the regular editing page
			http.Redirect(w, req, fmt.Sprintf("/%s/edit", page.Title), 303)
			return
		}
	}
	t.ExecuteTemplate(w, "base", page)
}

func (page Page) Update(w http.ResponseWriter, req *http.Request) {
	page.Title = NormaliseTitle(page.Slug)
	_, err := os.Stat(page.Path)
	if err == nil {
		page.Read()
	} else {
		page.RawContent = ""
	}
	newContent := req.FormValue("content")

	// Create the diff file for this update
	os.Mkdir(fmt.Sprintf("%s/versions", filepath.Dir(page.Path)), os.ModePerm)
	dmp := diffmatchpatch.New()
	patches := page.GetPatches()
	var diffs []diffmatchpatch.Diff
	if len(patches) == 0 {
		// There are no patches, so we start from scratch
		diffs = dmp.DiffMain("", newContent, false)
	} else {
		// Patches exist, so we generate a diff based on the current
		// version of the file
		diffs = dmp.DiffMain(page.RawContent, newContent, false)
	}
	patch := dmp.PatchMake(diffs)
	now := time.Now()
	timestamp := now.UnixMilli()
	df, err := os.Create(fmt.Sprintf("%s/versions/%s_%d.md", filepath.Dir(page.Path), page.Title, timestamp))
	check(err)
	defer df.Close()
	_, err2 := df.WriteString(dmp.PatchToText(patch))
	check(err2)
	df.Sync()

	// Save the new content to the file
	f, err := os.Create(page.Path)
	check(err)
	defer f.Close()
	_, err2 = f.WriteString(req.FormValue("content"))
	check(err2)
	f.Sync()
	http.Redirect(w, req, fmt.Sprintf("/%s", page.Title), 303)
}

func (page *Page) GetPatches() map[int][]diffmatchpatch.Patch {
	patchesMap := make(map[int][]diffmatchpatch.Patch)
	page.Title = NormaliseTitle(page.Slug)
	versionsDir := fmt.Sprintf("%s/versions", filepath.Dir(page.Path))
	_, err := os.Stat(page.Path)
	if err != nil {
		return patchesMap
	}
	_, err = os.Stat(versionsDir)
	check(err)
	dmp := diffmatchpatch.New()
	filepath.WalkDir(versionsDir, func(s string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if matched, err := filepath.Match(fmt.Sprintf("%s/%s_*.md", versionsDir, page.Title), s); err != nil {
			return err
		} else if matched {
			re := regexp.MustCompile("([0-9]*).md$")
			timestamp := re.FindStringSubmatch(s)[1]
			bytes, err := os.ReadFile(s)
			check(err)
			patch, err := dmp.PatchFromText(string(bytes))
			check(err)
			timestampInt, err := strconv.Atoi(timestamp)
			patchesMap[timestampInt] = patch
		}
		return nil
	})
	return patchesMap
}

// If a version exists for the requested timestamp, returns a string containing
// the text of the version and the index of the version in the list of versions.
// On an error, returns an empty string, -1, and an error.
func (page *Page) GetVersion(timestamp int) (string, int, error) {
	patches := page.GetPatches()
	// Does the supplied key exist in the patches map?
	if _, ok := patches[timestamp]; !ok {
		return "", -1, errors.New("No version exists for this timestamp.")
	}
	// Create a slice of the sorted patch timestamp keys
	keys := make([]int, 0, len(patches))
	for k := range patches {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	output := ""
	dmp := diffmatchpatch.New()
	var versionIndex int
	for i, v := range keys {
		if v == timestamp {
			// We've found the correct patch. Now we need to apply
			// each patch in order up to this one to reconstruct the
			// file at this version.
			for j, v := range keys {
				// Stop running through patches if we've reached
				// the correct index
				if j > i {
					break
				}
				patch := patches[v]
				output, _ = dmp.PatchApply(patch, output)
			}
			// We can stop looping as we've done the work
			versionIndex = i
			break
		}
	}
	return output, versionIndex, nil
}

func (page Page) ShowDiff(w http.ResponseWriter, req *http.Request) {
	// Before we do anything else, make sure the page exists
	_, err := os.Stat(page.Path)
	if err != nil {
		http.NotFound(w, req)
		return
	}
	page.Title = NormaliseTitle(page.Slug)
	page.Read()

	patches := page.GetPatches()
	// Create a slice of the sorted patch timestamp keys
	keys := make([]int, 0, len(patches))
	for k := range patches {
		keys = append(keys, k)
	}
	sort.Ints(keys)

	left, leftErr := strconv.Atoi(req.URL.Query().Get("left"))
	right, rightErr := strconv.Atoi(req.URL.Query().Get("right"))
	if leftErr != nil || rightErr != nil {
		// If either left or right aren't set, redirect to a route where
		// both are set to defaults (the most recent version and the
		// one directly before it). If there aren't two versions to
		// show, redirect away from the page.
		if len(patches) >= 2 {
			http.Redirect(w, req, fmt.Sprintf("/%s/diff?left=%d&right=%d", page.Title, keys[len(keys)-2], keys[len(keys)-1]), 303)
		} else {
			http.Redirect(w, req, fmt.Sprintf("/%s", page.Title), 303)
		}
		return
	}

	leftDiffDisplay := DiffDisplay{
		Side:      "left",
		Timestamp: left,
	}
	rightDiffDisplay := DiffDisplay{
		Side:      "right",
		Timestamp: right,
	}

	leftDiffDisplay.Date = time.Unix(0, int64(left)*int64(time.Millisecond)).Format("2006/01/02 15:04")
	rightDiffDisplay.Date = time.Unix(0, int64(right)*int64(time.Millisecond)).Format("2006/01/02 15:04")
	leftDiffDisplay.RawContent, leftDiffDisplay.DiffIndex, err = page.GetVersion(left)
	if err != nil {
		http.NotFound(w, req)
		return
	}
	rightDiffDisplay.RawContent, rightDiffDisplay.DiffIndex, err = page.GetVersion(right)
	if err != nil {
		http.NotFound(w, req)
		return
	}
	leftDiffDisplay.DiffIndex++
	rightDiffDisplay.DiffIndex++
	dmp := diffmatchpatch.New()
	leftDiffDisplay.Diff = dmp.DiffMain(rightDiffDisplay.RawContent, leftDiffDisplay.RawContent, false)
	rightDiffDisplay.Diff = dmp.DiffMain(leftDiffDisplay.RawContent, rightDiffDisplay.RawContent, false)
	t := CompileTemplate("diff.gohtml", req)
	page.Title = NormaliseTitle(page.Slug)

	for i, k := range keys {
		if k == left {
			if i > 0 {
				leftDiffDisplay.PrevTimestamp = keys[i-1]
			}
			if i < len(keys)-1 {
				leftDiffDisplay.NextTimestamp = keys[i+1]
			}
		}
		if k == right {
			if i > 0 {
				rightDiffDisplay.PrevTimestamp = keys[i-1]
			}
			if i < len(keys)-1 {
				rightDiffDisplay.NextTimestamp = keys[i+1]
			}
		}
	}
	leftDiffDisplay.DiffHtml = template.HTML(dmp.DiffPrettyHtml(leftDiffDisplay.Diff))
	rightDiffDisplay.DiffHtml = template.HTML(dmp.DiffPrettyHtml(rightDiffDisplay.Diff))

	data := map[string]interface{}{
		"Page":              page,
		"Left":              leftDiffDisplay,
		"Right":             rightDiffDisplay,
		"EarliestTimestamp": keys[0],
		"LatestTimestamp":   keys[len(keys)-1],
		"NumVersions":       len(keys),
		"WideDisplay":       true,
	}
	t.ExecuteTemplate(w, "base", data)
}

func NormaliseTitle(title string) string {
	// If the title is / or empty, it's the index page
	if title == "/" || title == "" {
		title = "index"
	}
	return strings.ReplaceAll(strings.ToLower(strings.Trim(title, "/. \t\n\r")), " ", "-")
}
