/* global $ _ requests server helper sidebar edits */
'use strict';
var meta = function() {
// ==UserScript==
// @name         MusicBrainz: Replace recording artists from an artist or work page
// @namespace    mbz-loujine
// @author       loujine
// @version      2016.6.22
// @downloadURL  https://bitbucket.org/loujine/musicbrainz-scripts/raw/default/mbz-replacerecordingartist.user.js
// @updateURL    https://bitbucket.org/loujine/musicbrainz-scripts/raw/default/mbz-replacerecordingartist.user.js
// @supportURL   https://bitbucket.org/loujine/musicbrainz-scripts
// @icon         https://bitbucket.org/loujine/musicbrainz-scripts/raw/default/icon.png
// @description  musicbrainz.org: Replace associated recording artist from an Artist or Work page
// @compatible   firefox+greasemonkey
// @licence      CC BY-NC-SA 3.0 (https://creativecommons.org/licenses/by-nc-sa/3.0/)
// @require      https://greasyfork.org/scripts/13747-mbz-loujine-common/code/mbz-loujine-common.js?version=133551
// @include      http*://*musicbrainz.org/artist/*/relationships
// @include      http*://*musicbrainz.org/work/*
// @exclude      http*://*musicbrainz.org/work/*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==
};
if (meta && meta.toString && (meta = meta.toString())) {
    var meta = {'name': meta.match(/@name\s+(.+)/)[1],
                'version': meta.match(/@version\s+(.+)/)[1]};
}

// imported from mbz-loujine-common.js: requests, server, sidebar
var editNoteMsg = 'CSG: Set performer(s) as recording artist\n';

function formatPerformers(relations) {
    var performers = [];
    relations.forEach(function(rel) {
        var type;
        if (rel.type === 'instrument' || rel.type === 'vocal' ||
            rel.type === 'conductor' || rel.type === 'performing orchestra' ||
            rel.type === 'performer') {
            if (rel.type === 'performing orchestra') {
                type = 'orchestra';
            } else if (!rel.attributes.length) {
                type = rel.type;
            } else {
                type = rel.attributes[0];
            }
            performers.push(type + ': ' + rel.artist.name);
        }
    });
    return performers.sort().join(', ');
}

function showPerformers(start, maxcount) {
    var $rows;
    if (helper.isArtistURL) {
        var performer = helper.mbidFromURL(),
            $allRows = $('table.tbl a[href*="/artist/"]').parents('tr'),
            $performerRows = $('table.tbl a[href*="/artist/' + performer + '"]').parents('tr');
        $rows = $allRows.not($performerRows);
        document.getElementById('loujine-locale').hidden = false;
    } else if (helper.isWorkURL) {
        var composer = $('th:contains("composer:")').parent().find('a').attr('href').split('/')[2];
        $rows = $('table.tbl a[href*="/artist/' + composer + '"]').parents('tr');
    }
    $rows = $($rows.get().reverse().splice(start, maxcount));
    if (!$('#ARperformerColumn').length) {
        $('thead > tr').append('<th id="ARperformerColumn">Performer AR</th>');
        $('.subh > th')[1].colSpan += 1;
    }

    $rows.each(function (idx, tr) {
        setTimeout(function () {
            var mbid = $(tr).find('a[href*="/recording/"]').attr('href').split('/')[2],
                url = helper.wsUrl('recording', ['artist-rels'], mbid);
            requests.GET(url, function (response) {
                var resp = JSON.parse(response),
                    $node,
                    $button;
                if (resp.relations.length) {
                    $node = $('<td>' + formatPerformers(resp.relations) + '</td>');
                    $button = $('<input>', {
                        'id': 'replace-' + mbid,
                        'class': 'replace',
                        'type': 'checkbox',
                        'value': 'Replace artist'
                    });
                    $node.append($button);
                } else {
                    $node = $('<td>✗</td>').css('color', 'red');
                }
                $(tr).append($node);
            });
        }, idx * server.timeout);
    });
}

// Replace composer -> performer as recording artist (CSG)
function parseArtistEditData(data, performers) {
    var performerName,
        mbid = helper.mbidFromURL();
    performers.sort(helper.comparefct).forEach(function (performer, idx) {
        if (helper.isArtistURL() && performer.mbid === mbid) {
            performerName = $('#performerAlias')[0].selectedOptions[0].text;
        } else {
            performerName = performer.name;
        }
        data['artist_credit.names.' + idx + '.name'] = edits.encodeName(performerName);
        // data['artist_credit.names.' + idx + '.name'] = edits.encodeName(creditedName);
        data['artist_credit.names.' + idx + '.join_phrase'] = (idx === performers.length - 1) ? null : ',+';
        data['artist_credit.names.' + idx + '.artist.name'] = edits.encodeName(performer.name);
        data['artist_credit.names.' + idx + '.artist.id'] = performer.id;
    });
}

function parseEditData(editData) {
    var data = {},
        performers = [];
    data['name'] = edits.encodeName(editData.name);
    data['comment'] = editData.comment ? editData.comment : null;
    if (!editData.isrcs.length) {
        data['isrcs.0'] = null;
    } else {
        editData.isrcs.forEach(function (isrc, idx) {
            data['isrcs.' + idx] = isrc;
        });
    }
    editData.relationships.forEach(function (rel) {
        var linkType = rel.linkTypeID,
            uniqueIds = [];
        if (_.includes(server.performingLinkTypes(), linkType) &&
                !_.includes(uniqueIds, rel.target.id)) {
            uniqueIds.push(rel.target.id); // filter duplicates
            performers.push({'name': rel.target.name,
                             'id': rel.target.id,
                             'link': linkType,
                             'mbid': rel.target.gid
            });
        }
    });
    parseArtistEditData(data, performers.sort(helper.comparefct));
    data['edit_note'] = $('#batch_replace_edit_note')[0].value;
    data['make_votable'] = document.getElementById('votable').checked ? '1' : '0';
    return data;
}

function replaceArtist() {
    $('.replace:input:checked:enabled').each(function (idx, node) {
        var mbid = node.id.replace('replace-', ''),
            url = edits.urlFromMbid('recording', mbid);
        function success(xhr) {
            var $status = $('#' + node.id + '-text');
            node.disabled = true;
            $status.text(
                'Success (code ' + xhr.status + ')'
            ).parent().css('color', 'green');
            var editId = new RegExp(
                '/edit/(.*)">edit</a>'
            ).exec(xhr.responseText)[1];
            $status.after(
                $('<p>').append(
                    '<a href="/edit/' + editId + '" target="_blank">edit ' + editId + '</a>'
                )
            )
        }
        function fail(xhr) {
            $('#' + node.id + '-text').text(
                'Error (code ' + xhr.status + ')'
            ).parent().css('color', 'red');
        }
        function callback(editData) {
            $('#' + node.id + '-text').text('Sending edit data');
            var postData = parseEditData(editData);
            console.info('Data ready to be posted: ', postData);
            requests.POST(url, edits.formatEdit('edit-recording', postData),
                          success, fail);
        }
        setTimeout(function () {
            $('#' + node.id + '-text').empty();
            $(node).after('<span id="' + node.id + '-text">Fetching required data</span>');
            edits.getEditParams(url, callback);
        }, 2 * idx * server.timeout);
    });
}

(function displaySidebar(sidebar) {
    sidebar.container()
    .append(
        $('<h3>Show performers</h3>')
    ).append(
        $('<p>Show performers present in recording AR, for recordings not respecting the CSG</p>')
    ).append(
        $('<div>')
        .append('First row:')
        .append(
            $('<input>', {
                'id': 'offset',
                'type': 'number',
                'style': 'width: 50px',
                'value': '1'
            })
        )
    ).append(
        $('<div>')
        .append('Rows to query:')
        .append(
            $('<input>', {
                'id': 'max',
                'type': 'number',
                'style': 'width: 50px',
                'value': '10'
            })
        )
    ).append(
        $('<input>', {
            'id': 'showperformers',
            'type': 'button',
            'value': 'Show performer AR'
        })
    ).append(
        $('<h3>Replace artists</h3>')
    ).append(
        $('<p>First click "Show performer AR" then check boxes to select artists</p>')
    ).append(
        $('<input>', {
            'id': 'batch_select',
            'type': 'button',
            'disabled': true,
            'value': 'Select all'
        })
    ).append(
        $('<p>', {
            'id': 'loujine-locale',
            'hidden': true
        }).append('Primary locale alias to use:')
        .append($('<select>', {'id': 'performerAlias'}))
    ).append(
        $('<div>', {'class': 'auto-editor'})
        .append(
            $('<label>Make all edits votable</label>')
            .append($('<input>',
                      {'type': 'checkbox',
                       'id': 'votable'})
            )
        )
    ).append(
        $('<p>').append('Edit note:')
        .append(
            $('<textarea></textarea>', {
                'id': 'batch_replace_edit_note',
                'disabled': true,
                'text': sidebar.editNote(meta, editNoteMsg)
            })
        )
    ).append(
        $('<input>', {
            'id': 'batch_replace',
            'type': 'button',
            'disabled': true,
            'value': 'Replace selected artists'
        })
    );
})(sidebar);

function parseAliases() {
    if (helper.isArtistURL) {
        var url = helper.wsUrl('artist', ['aliases']),
            callback = function (aliasObject) {
                $.each(aliasObject, function(locale, name) {
                    $('#performerAlias').append(
                        $('<option>', {'value': locale}).append(name)
                    );
                });
            };

        requests.GET(url, function (response) {
            var resp = JSON.parse(response),
                aliases = {'default': resp.name};
            $('#performerAlias').append(
                $('<option>', {'value': 'default'}).append(resp.name)
            );
            if (resp.aliases.length) {
                resp.aliases.forEach(function (alias) {
                    if (alias.locale) {
                        aliases[alias.locale] = alias.name;
                    }
                });
                callback(aliases);
            }
        });
    }
}

parseAliases();

$(document).ready(function () {
    $('#showperformers').click(function () {
        var start = $('#offset')[0].value,
            maxcount = $('#max')[0].value;
        showPerformers(parseInt(start - 1), parseInt(maxcount));
        $('#batch_select').prop('disabled', false);
        $('#batch_replace_edit_note').prop('disabled', false);
        $('#batch_replace').prop('disabled', false);
    });
    $('#batch_replace').click(function () {replaceArtist();});
    $('#batch_select').click(function () {
        $('.replace:input').attr('checked', true);
    });
    return false;
});
