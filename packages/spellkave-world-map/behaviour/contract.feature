@persona:map-developer
Feature: How world-map answers
  `world-map export` writes files and prints one JSON summary on stdout. Help
  goes to stdout and succeeds. A request it cannot make sense of exits 2 and
  says why on stderr; a source it cannot read exits 1 and writes nothing.

  Rule: Help goes to stdout and succeeds

    @code:src/cli.ts:runCli @launcher
    Scenario Outline: bin/<launcher> prints the usage
      The other scenarios run a bundle of the same entry for speed; these start
      the real launchers, as a person does. `world-osm` is the old name, kept
      for one release.
      When I run "<launcher> --help" through the front door
      Then world-map succeeds
      And stderr is empty and stdout carries the help
      And stdout shows the usage once

      Examples:
        | launcher  |
        | world-map |
        | world-osm |

    @code:src/cli.ts:runCli
    Example: no arguments at all prints the usage
      When I run "world-map"
      Then world-map succeeds
      And stderr is empty and stdout carries the help

  Rule: A request it cannot make sense of exits 2 and says why on stderr

    @code:src/cli.ts:runCli
    Scenario Outline: <request> is refused
      When I run "world-map <arguments>"
      Then world-map exits with 2
      And stdout is empty and stderr says "<message>"
      And stderr <usage> the usage

      Examples:
        | request                 | arguments                        | message                                                                    | usage         |
        | an unknown command      | frobnicate                       | unknown command: frobnicate                                                | shows         |
        | export without a source | export                           | export requires <bundle-dir\|rows.json>                                    | shows         |
        | export without a file   | export rows.json                 | export requires at least one of --xml / --json / --backdrops / --manifest | does not show |
        | an unknown option       | export rows.json --geojson x.json | unknown argument: --geojson                                                | shows         |

  Rule: A source it cannot read exits 1 and writes nothing

    @code:src/cli.ts:runCli
    Example: a bundle directory that does not exist
      When I run "world-map export no-such-adventure --json map.json"
      Then world-map exits with 1
      And stdout is empty and stderr says "world-map export failed:"
      And no file "map.json" was written
