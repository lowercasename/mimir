package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/BurntSushi/toml"
)

// Global config variable
var config Config

type Config struct {
	SiteTitle       string `toml:"site_title"`
	RestrictEditing bool   `toml:"restrict_editing"`
	Username        string `toml:"username"`
	Password        string `toml:"password"`
}

// A map to store current user sessions in memory
var sessions = map[string]Session{}

func main() {
	port := flag.Int("port", 8010, "The TCP port the app server should listen on.")
	configFile := flag.String("config", "", "The location of Mimir's config file.")
	wikiDir := flag.String("dir", "", "The base wiki directory.")
	flag.Parse()
	if *configFile == "" {
		fmt.Printf("Please specify a config file.")
		os.Exit(1)
	}
	if *wikiDir == "" {
		fmt.Printf("Please specify a base wiki directory.")
		os.Exit(1)
	}

	server := Server{Path: strings.TrimRight(*wikiDir, "/")}

	bytes, err := os.ReadFile(*configFile)
	check(err)
	configFileContent := string(bytes)
	_, err = toml.Decode(configFileContent, &config)

	fmt.Printf("Serving %s\n", *wikiDir)
	fmt.Printf("Listening on http://127.0.0.1:%d\n", *port)

	static := http.FileServer(http.Dir("static"))
	http.Handle("/static/", http.StripPrefix("/static/", static))

	fmt.Println(http.ListenAndServe(fmt.Sprintf(":%d", *port), http.HandlerFunc(server.Serve)))
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}
